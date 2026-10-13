//! What JobSpy does to HTML, reproduced exactly: a BeautifulSoup(`html.parser`) tree (no HTML5 tree fixing),
//! bs4 `prettify()` and markdownify 1.2.2 with default options (`markdown_converter`).

use std::cell::RefCell;

use html5ever::tokenizer::states::RawKind;
use html5ever::tokenizer::{BufferQueue, TagKind, Token, TokenSink, TokenSinkResult, Tokenizer};

#[derive(Debug, Clone)]
pub enum Node {
    Element(Element),
    Text(String),
    Comment(String),
    Doctype(String),
}

#[derive(Debug, Clone, Default)]
pub struct Element {
    pub name: String,
    pub attrs: Vec<(String, String)>,
    pub children: Vec<Node>,
}

impl Node {
    fn element(&self) -> Option<&Element> {
        match self {
            Node::Element(e) => Some(e),
            _ => None,
        }
    }
    fn name(&self) -> Option<&str> {
        self.element().map(|e| e.name.as_str())
    }
}

impl Element {
    pub fn attr(&self, key: &str) -> Option<&str> {
        self.attrs.iter().find(|(k, _)| k == key).map(|(_, v)| v.as_str())
    }

    pub fn has_class(&self, class: &str) -> bool {
        self.attr("class")
            .is_some_and(|v| v.split_ascii_whitespace().any(|c| c == class))
    }

    /// Descendant elements in document order (bs4 `find_all`).
    pub fn find_all<'a>(&'a self, pred: &dyn Fn(&Element) -> bool) -> Vec<&'a Element> {
        let mut out = Vec::new();
        self.collect(pred, &mut out);
        out
    }

    fn collect<'a>(&'a self, pred: &dyn Fn(&Element) -> bool, out: &mut Vec<&'a Element>) {
        for e in self.children.iter().filter_map(Node::element) {
            if pred(e) {
                out.push(e);
            }
            e.collect(pred, out);
        }
    }

    pub fn find(&self, pred: &dyn Fn(&Element) -> bool) -> Option<&Element> {
        self.find_all(pred).into_iter().next()
    }

    /// bs4 `get_text()` (script/style contents excluded).
    pub fn text(&self) -> String {
        let mut out = String::new();
        self.push_strings(&mut |t| out.push_str(t));
        out
    }

    /// bs4 `get_text(strip=True)`: every string stripped, empty ones dropped, concatenated.
    pub fn text_strip(&self) -> String {
        let mut out = String::new();
        self.push_strings(&mut |t| out.push_str(py_strip(t)));
        out
    }

    fn push_strings(&self, f: &mut dyn FnMut(&str)) {
        for c in &self.children {
            match c {
                Node::Text(t) if !matches!(self.name.as_str(), "script" | "style") => f(t),
                Node::Element(e) => e.push_strings(f),
                _ => {}
            }
        }
    }
}

/// Python `str.isspace()` for one char.
fn is_py_space(c: char) -> bool {
    c.is_whitespace() || ('\x1c'..='\x1f').contains(&c)
}

/// Python `str.strip()`.
pub fn py_strip(s: &str) -> &str {
    s.trim_matches(is_py_space)
}

// ── Parsing: bs4's BeautifulSoupHTMLParser + tree builder semantics ───────────────────────────────

const VOID: &[&str] = &[
    "area", "base", "br", "col", "embed", "hr", "img", "input", "keygen", "link", "menuitem", "meta", "param",
    "source", "track", "wbr", "basefont", "bgsound", "command", "frame", "image", "isindex", "nextid", "spacer",
];
const PRESERVE_WS: &[&str] = &["pre", "textarea"];

#[derive(Default)]
struct Builder {
    stack: Vec<Element>,
    data: String,
    closed_void: Vec<String>,
    preserve: usize,
}

impl Builder {
    fn end_data(&mut self) {
        if self.data.is_empty() {
            return;
        }
        let mut data = std::mem::take(&mut self.data);
        // bs4 collapses ASCII-whitespace-only strings to one newline or space (outside <pre>/<textarea>).
        if self.preserve == 0 && data.chars().all(|c| " \n\t\x0c\r".contains(c)) {
            data = if data.contains('\n') { "\n" } else { " " }.into();
        }
        self.stack.last_mut().unwrap().children.push(Node::Text(data));
    }

    fn pop(&mut self) {
        let el = self.stack.pop().unwrap();
        if PRESERVE_WS.contains(&el.name.as_str()) {
            self.preserve = self.preserve.saturating_sub(1);
        }
        self.stack.last_mut().unwrap().children.push(Node::Element(el));
    }

    fn start(&mut self, name: &str, attrs: Vec<(String, String)>, handle_empty: bool) {
        self.end_data();
        let mut deduped: Vec<(String, String)> = Vec::new();
        for (k, v) in attrs {
            match deduped.iter_mut().find(|(dk, _)| *dk == k) {
                Some(slot) => slot.1 = v, // last value wins
                None => deduped.push((k, v)),
            }
        }
        if PRESERVE_WS.contains(&name) {
            self.preserve += 1;
        }
        self.stack.push(Element {
            name: name.into(),
            attrs: deduped,
            children: vec![],
        });
        if handle_empty && VOID.contains(&name) {
            self.end(name, false);
            self.closed_void.push(name.into());
        }
    }

    fn end(&mut self, name: &str, check_already_closed: bool) {
        if check_already_closed && let Some(i) = self.closed_void.iter().position(|n| n == name) {
            self.closed_void.remove(i);
            return;
        }
        self.end_data();
        if let Some(i) = self.stack.iter().skip(1).rposition(|e| e.name == name) {
            while self.stack.len() > i + 1 {
                self.pop();
            }
        }
    }
}

struct Sink(RefCell<Builder>);

impl TokenSink for Sink {
    type Handle = ();

    fn process_token(&self, token: Token, _line: u64) -> TokenSinkResult<()> {
        let mut b = self.0.borrow_mut();
        match token {
            Token::TagToken(tag) => {
                let name = tag.name.to_string();
                match tag.kind {
                    TagKind::StartTag => {
                        let attrs = tag
                            .attrs
                            .iter()
                            .map(|a| (a.name.local.to_string(), a.value.to_string()))
                            .collect();
                        if tag.self_closing {
                            b.start(&name, attrs, false);
                            b.end(&name, true);
                        } else {
                            b.start(&name, attrs, true);
                            if matches!(name.as_str(), "script" | "style") {
                                return TokenSinkResult::RawData(RawKind::Rawtext);
                            }
                        }
                    }
                    TagKind::EndTag => b.end(&name, true),
                }
            }
            Token::CharacterTokens(t) => b.data.push_str(&t),
            Token::CommentToken(c) => {
                b.end_data();
                b.stack.last_mut().unwrap().children.push(Node::Comment(c.to_string()));
            }
            Token::DoctypeToken(d) => {
                b.end_data();
                let name = d.name.map(|n| n.to_string()).unwrap_or_default();
                b.stack.last_mut().unwrap().children.push(Node::Doctype(name));
            }
            Token::NullCharacterToken | Token::EOFToken | Token::ParseError(_) => {}
        }
        TokenSinkResult::Continue
    }
}

/// `BeautifulSoup(html, "html.parser")`: the returned element is the `[document]` root.
pub fn parse(html: &str) -> Element {
    let builder = Builder {
        stack: vec![Element {
            name: "[document]".into(),
            ..Element::default()
        }],
        ..Builder::default()
    };
    let tok = Tokenizer::new(Sink(RefCell::new(builder)), Default::default());
    let input = BufferQueue::default();
    input.push_back(html.into());
    let _ = tok.feed(&input);
    tok.end();
    let mut b = tok.sink.0.into_inner();
    b.end_data();
    while b.stack.len() > 1 {
        b.pop();
    }
    b.stack.pop().unwrap()
}

// ── bs4 Tag.prettify(formatter="html") ───────────────────────────────────────────────────────────

fn escape(s: &str, quote: bool) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' if quote => out.push_str("&quot;"),
            c => out.push(c),
        }
    }
    out
}

/// `str.strip()` applied after the "html" formatter has turned some whitespace into named entities
/// (`&nbsp;`, `&ensp;`, ...), which therefore survive.
fn pretty_strip(s: &str) -> &str {
    s.trim_matches(|c: char| {
        is_py_space(c) && !matches!(c, '\u{a0}' | '\u{2002}'..='\u{2005}' | '\u{2007}'..='\u{200a}' | '\u{205f}')
    })
}

struct Pretty {
    out: String,
    level: usize,
    literal: bool,
}

impl Pretty {
    fn piece(&mut self, piece: &str, before: bool, after: bool) {
        if piece.is_empty() {
            return;
        }
        if before && self.level > 0 {
            self.out.extend(std::iter::repeat_n(' ', self.level));
        }
        self.out.push_str(piece);
        if after {
            self.out.push('\n');
        }
    }

    fn node(&mut self, node: &Node) {
        let (b, a) = (!self.literal, !self.literal);
        match node {
            Node::Text(t) => {
                let t = escape(t, false);
                self.piece(if self.literal { &t } else { pretty_strip(&t) }, b, a);
            }
            Node::Comment(c) => {
                let c = format!("<!--{c}-->");
                self.piece(if self.literal { &c } else { pretty_strip(&c) }, b, a);
            }
            Node::Doctype(d) => self.piece(&format!("<!DOCTYPE {d}>"), b, a),
            Node::Element(e) => self.element(e),
        }
    }

    fn element(&mut self, e: &Element) {
        let mut attrs: Vec<&(String, String)> = e.attrs.iter().collect();
        attrs.sort();
        let attrs: String = attrs
            .iter()
            .map(|(k, v)| format!(" {k}=\"{}\"", escape(v, true)))
            .collect();
        if e.children.is_empty() && VOID.contains(&e.name.as_str()) {
            let piece = format!("<{}{attrs}/>", e.name);
            let lit = self.literal;
            self.piece(&piece, !lit, !lit);
            return;
        }
        let opens_literal = !self.literal && PRESERVE_WS.contains(&e.name.as_str());
        let (b, a) = if opens_literal {
            (true, false)
        } else {
            (!self.literal, !self.literal)
        };
        self.piece(&format!("<{}{attrs}>", e.name), b, a);
        self.literal |= opens_literal;
        self.level += 1;
        for c in &e.children {
            self.node(c);
        }
        self.level -= 1;
        let (b, a) = if opens_literal {
            self.literal = false;
            (false, true)
        } else {
            (!self.literal, !self.literal)
        };
        self.piece(&format!("</{}>", e.name), b, a);
    }
}

/// bs4 `tag.prettify(formatter="html")`.
pub fn prettify(e: &Element) -> String {
    let mut p = Pretty {
        out: String::new(),
        level: 0,
        literal: false,
    };
    p.element(e);
    p.out
}

// ── markdownify 1.2.2, default options ───────────────────────────────────────────────────────────

/// JobSpy `markdown_converter`: markdownify + strip.
pub fn markdown(html: &str) -> String {
    let html = if html.contains('<') {
        html.to_string()
    } else {
        format!("<!---->{html}")
    };
    let doc = parse(&html);
    let text = process_tag(&doc, None, &[]);
    py_strip(text.trim_matches('\n')).to_string()
}

fn is_heading(name: &str) -> Option<usize> {
    let digits: String = name
        .strip_prefix('h')?
        .chars()
        .take_while(char::is_ascii_digit)
        .collect();
    digits.parse().ok()
}

fn remove_ws_inside(name: Option<&str>) -> bool {
    name.is_some_and(|n| {
        is_heading(n).is_some()
            || matches!(
                n,
                "p" | "blockquote"
                    | "article"
                    | "div"
                    | "section"
                    | "ol"
                    | "ul"
                    | "li"
                    | "dl"
                    | "dt"
                    | "dd"
                    | "table"
                    | "thead"
                    | "tbody"
                    | "tfoot"
                    | "tr"
                    | "td"
                    | "th"
            )
    })
}

fn remove_ws_outside(node: Option<&Node>) -> bool {
    let name = node.and_then(Node::name);
    remove_ws_inside(name) || name == Some("pre")
}

fn is_block_content(n: &Node) -> bool {
    match n {
        Node::Element(_) => true,
        Node::Text(t) => !py_strip(t).is_empty(),
        _ => false,
    }
}

/// An element's place in the tree: its parent and its index among the parent's children.
#[derive(Clone, Copy)]
struct Pos<'a> {
    parent: &'a Element,
    index: usize,
}

impl<'a> Pos<'a> {
    fn prev(&self) -> Option<&'a Node> {
        self.index.checked_sub(1).map(|i| &self.parent.children[i])
    }
    fn next(&self) -> Option<&'a Node> {
        self.parent.children.get(self.index + 1)
    }
}

/// `parent_tags` holds tag names plus the pseudo-tags `_inline` / `_noformat`.
fn process_tag(node: &Element, pos: Option<Pos>, ancestors: &[&Element]) -> String {
    let inside = remove_ws_inside(Some(&node.name));
    let parent_tags: Vec<&str> = ancestor_tags(ancestors);
    let mut child_ancestors = ancestors.to_vec();
    child_ancestors.push(node);

    let mut strings: Vec<String> = Vec::new();
    for (i, child) in node.children.iter().enumerate() {
        let cp = Pos { parent: node, index: i };
        let ignore = match child {
            Node::Element(_) => false,
            Node::Comment(_) | Node::Doctype(_) => true,
            Node::Text(t) => {
                py_strip(t).is_empty()
                    && ((inside && (cp.prev().is_none() || cp.next().is_none()))
                        || remove_ws_outside(cp.prev())
                        || remove_ws_outside(cp.next()))
            }
        };
        if ignore {
            continue;
        }
        let s = match child {
            Node::Element(e) => process_tag(e, Some(cp), &child_ancestors),
            Node::Text(t) => process_text(t, cp, &ancestor_tags(&child_ancestors)),
            _ => unreachable!(),
        };
        if !s.is_empty() {
            strings.push(s);
        }
    }

    let text = if node.name == "pre" || parent_tags.contains(&"pre") {
        strings.concat()
    } else {
        // Collapse newlines at child boundaries to at most two.
        let mut out: Vec<String> = vec![String::new()];
        for s in strings {
            let lead_n = s.len() - s.trim_start_matches('\n').len();
            let (lead, rest) = s.split_at(lead_n);
            let content = rest.trim_end_matches('\n');
            let trail = &rest[content.len()..];
            let mut lead = lead.to_string();
            if !out.last().unwrap().is_empty() && !lead.is_empty() {
                let prev = out.pop().unwrap();
                lead = "\n".repeat(prev.len().max(lead.len()).min(2));
            }
            out.extend([lead, content.to_string(), trail.to_string()]);
        }
        out.concat()
    };
    convert(node, text, pos, &parent_tags, ancestors)
}

fn ancestor_tags<'a>(ancestors: &[&'a Element]) -> Vec<&'a str> {
    let mut tags = Vec::new();
    for a in ancestors {
        tags.push(a.name.as_str());
        if is_heading(&a.name).is_some() || matches!(a.name.as_str(), "td" | "th") {
            tags.push("_inline");
        }
        if matches!(a.name.as_str(), "pre" | "code" | "kbd" | "samp") {
            tags.push("_noformat");
        }
    }
    tags
}

fn process_text(text: &str, pos: Pos, parent_tags: &[&str]) -> String {
    static NEWLINE_WS: std::sync::LazyLock<regex::Regex> =
        std::sync::LazyLock::new(|| regex::Regex::new(r"[\t \r\n]*[\r\n][\t \r\n]*").unwrap());
    static WS: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| regex::Regex::new(r"[\t ]+").unwrap());

    let mut text = text.to_string();
    if !parent_tags.contains(&"pre") {
        text = WS.replace_all(&NEWLINE_WS.replace_all(&text, "\n"), " ").into_owned();
    }
    if !parent_tags.contains(&"_noformat") {
        text = text.replace('*', r"\*").replace('_', r"\_");
    }
    let inside = remove_ws_inside(Some(&pos.parent.name));
    if remove_ws_outside(pos.prev()) || (inside && pos.prev().is_none()) {
        text = text.trim_start_matches([' ', '\t', '\r', '\n']).to_string();
    }
    if remove_ws_outside(pos.next()) || (inside && pos.next().is_none()) {
        text = text.trim_end_matches(is_py_space).to_string();
    }
    text
}

/// markdownify `chomp`: move one leading/trailing space outside the markup.
fn chomp(text: &str) -> (&'static str, &'static str, &str) {
    let prefix = if text.starts_with(' ') { " " } else { "" };
    let suffix = if text.ends_with(' ') { " " } else { "" };
    (prefix, suffix, py_strip(text))
}

fn inline(markup: &str, text: &str, parent_tags: &[&str]) -> String {
    if parent_tags.contains(&"_noformat") {
        return text.to_string();
    }
    let (p, s, t) = chomp(text);
    if t.is_empty() {
        String::new()
    } else {
        format!("{p}{markup}{t}{markup}{s}")
    }
}

/// Prefix every non-empty line (markdownify's `re_line_with_content` substitutions).
fn indent_lines(text: &str, indent: &str, empty: &str) -> String {
    text.split('\n')
        .map(|l| {
            if l.is_empty() {
                empty.to_string()
            } else {
                format!("{indent}{l}")
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

// ponytail: tables, <dl>/<dt>/<dd> and <video> fall through as plain text (absent from job descriptions so far);
// port markdownify's convert_tr/td/dd/dt if a board starts sending them.
fn convert(el: &Element, text: String, pos: Option<Pos>, parent_tags: &[&str], ancestors: &[&Element]) -> String {
    let inl = parent_tags.contains(&"_inline");
    match el.name.as_str() {
        "[document]" => text.trim_matches('\n').to_string(),
        "a" => {
            if parent_tags.contains(&"_noformat") {
                return text;
            }
            let (p, s, t) = chomp(&text);
            if t.is_empty() {
                return String::new();
            }
            let href = el.attr("href").unwrap_or("");
            let title = el.attr("title").unwrap_or("");
            if !href.is_empty() && t.replace(r"\_", "_") == href && title.is_empty() {
                return format!("<{href}>");
            }
            let title_part = if title.is_empty() {
                String::new()
            } else {
                format!(" \"{}\"", title.replace('"', "\\\""))
            };
            if href.is_empty() {
                t.to_string()
            } else {
                format!("{p}[{t}]({href}{title_part}){s}")
            }
        }
        "b" | "strong" => inline("**", &text, parent_tags),
        "em" | "i" => inline("*", &text, parent_tags),
        "del" | "s" => inline("~~", &text, parent_tags),
        "sub" | "sup" => inline("", &text, parent_tags),
        "blockquote" => {
            let t = text.trim_matches([' ', '\t', '\r', '\n']);
            if inl {
                format!(" {t} ")
            } else if t.is_empty() {
                "\n".into()
            } else {
                format!("\n{}\n\n", indent_lines(t, "> ", ">"))
            }
        }
        "br" => if inl { " " } else { "  \n" }.into(),
        "code" | "kbd" | "samp" => {
            if parent_tags.contains(&"_noformat") {
                return text;
            }
            let (p, s, t) = chomp(&text);
            if t.is_empty() {
                return String::new();
            }
            let max = t.split(|c| c != '`').map(str::len).max().unwrap_or(0);
            let delim = "`".repeat(max + 1);
            let t = if max > 0 { format!(" {t} ") } else { t.to_string() };
            format!("{p}{delim}{t}{delim}{s}")
        }
        "div" | "article" | "section" | "dl" => {
            let t = py_strip(&text);
            if inl {
                format!(" {t} ")
            } else if t.is_empty() {
                String::new()
            } else {
                format!("\n\n{t}\n\n")
            }
        }
        "hr" => "\n\n---\n\n".into(),
        "img" => {
            let (alt, src, title) = (
                el.attr("alt").unwrap_or(""),
                el.attr("src").unwrap_or(""),
                el.attr("title").unwrap_or(""),
            );
            if inl {
                return alt.into();
            }
            let title_part = if title.is_empty() {
                String::new()
            } else {
                format!(" \"{}\"", title.replace('"', "\\\""))
            };
            format!("![{alt}]({src}{title_part})")
        }
        "ul" | "ol" => {
            let pos = pos.expect("list has a parent");
            let next_content = pos.parent.children[pos.index + 1..]
                .iter()
                .find(|n| is_block_content(n));
            let before_paragraph = next_content.is_some_and(|n| !matches!(n.name(), Some("ul" | "ol")));
            if parent_tags.contains(&"li") {
                format!("\n{}", text.trim_end_matches(is_py_space))
            } else {
                format!("\n\n{text}{}", if before_paragraph { "\n" } else { "" })
            }
        }
        "li" => {
            let t = py_strip(&text);
            if t.is_empty() {
                return "\n".into();
            }
            let parent = ancestors.last();
            let bullet = if parent.is_some_and(|p| p.name == "ol") {
                let start = parent
                    .and_then(|p| p.attr("start"))
                    .filter(|s| !s.is_empty() && s.chars().all(|c| c.is_ascii_digit()))
                    .and_then(|s| s.parse::<i64>().ok())
                    .unwrap_or(1);
                let pos = pos.expect("li has a parent");
                let prev_li = pos.parent.children[..pos.index]
                    .iter()
                    .filter(|n| n.name() == Some("li"))
                    .count();
                format!("{}. ", start + prev_li as i64)
            } else {
                let depth = ancestors.iter().filter(|a| a.name == "ul").count() as i64 - 1;
                format!("{} ", ['*', '+', '-'][depth.rem_euclid(3) as usize])
            };
            let width = bullet.chars().count();
            let indented = indent_lines(t, &" ".repeat(width), "");
            format!("{bullet}{}\n", indented.chars().skip(width).collect::<String>())
        }
        "p" => {
            let t = text.trim_matches([' ', '\t', '\r', '\n']);
            if inl {
                format!(" {t} ")
            } else if t.is_empty() {
                String::new()
            } else {
                format!("\n\n{t}\n\n")
            }
        }
        "pre" => {
            if text.is_empty() {
                return String::new();
            }
            static LSTRIP: std::sync::LazyLock<regex::Regex> =
                std::sync::LazyLock::new(|| regex::Regex::new(r"^[ \n]*\n").unwrap());
            let t = LSTRIP.replace(&text, "");
            let t = t.trim_end_matches([' ', '\n']);
            format!("\n\n```\n{t}\n```\n\n")
        }
        "q" => format!("\"{text}\""),
        "script" | "style" => String::new(),
        name => match is_heading(name) {
            Some(n) => {
                if inl {
                    return text;
                }
                let n = n.clamp(1, 6);
                let t = py_strip(&text);
                if n <= 2 {
                    let t = t.trim_end_matches(is_py_space);
                    if t.is_empty() {
                        String::new()
                    } else {
                        let line = if n == 1 { "=" } else { "-" }.repeat(t.chars().count());
                        format!("\n\n{t}\n{line}\n\n")
                    }
                } else {
                    static ALL_WS: std::sync::LazyLock<regex::Regex> =
                        std::sync::LazyLock::new(|| regex::Regex::new(r"[\t \r\n]+").unwrap());
                    format!("\n\n{} {}\n\n", "#".repeat(n), ALL_WS.replace_all(t, " "))
                }
            }
            None => text,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn markdownify_basics() {
        assert_eq!(
            markdown("<p>Hello <b>bold</b> <i>it</i></p><ul><li>a</li><li>b_c</li></ul>"),
            "Hello **bold** *it*\n\n* a\n* b\\_c"
        );
        assert_eq!(markdown("plain *text*"), "plain \\*text\\*");
        assert_eq!(markdown("<ol start=\"3\"><li>x</li><li>y</li></ol>"), "3. x\n4. y");
        assert_eq!(markdown("<h2>Title</h2><p>a<br>b</p>"), "Title\n-----\n\na  \nb");
        assert_eq!(markdown("<a href=\"http://x.y\">http://x.y</a>"), "<http://x.y>");
    }

    #[test]
    fn soup_tree() {
        // html.parser keeps <p> nested inside <p>; whitespace-only strings collapse.
        let doc = parse("<p>a<p>b</p>  </p>");
        let p = doc.children[0].element().unwrap();
        assert_eq!(p.name, "p");
        assert!(matches!(&p.children[1], Node::Element(e) if e.name == "p"));
        assert!(matches!(&p.children[2], Node::Text(t) if t == " "));
        assert_eq!(prettify(p), "<p>\n a\n <p>\n  b\n </p>\n</p>\n");
    }
}
