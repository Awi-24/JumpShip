import { useState, useEffect, useMemo } from 'react';

/** One-liner joke + where the riff comes from (show, film, game, meme, etc.). */
const MESSAGES: { line: string; ref: string }[] = [
  { line: 'A lion does not concern himself with the opinion of HR.', ref: 'Game of Thrones (HBO, 2011-2019)' },
  { line: 'Winter is coming. So is the calibration exercise.', ref: 'Game of Thrones' },
  { line: 'You know nothing, Jon Snow... about who owns the IP clause.', ref: 'Game of Thrones' },
  { line: 'One does not simply walk into a job offer. There is usually a Workday portal.', ref: 'The Lord of the Rings: The Fellowship of the Ring (2001)' },
  { line: 'May the fourth round of interviews be with you.', ref: 'Star Wars (1977+)' },
  { line: 'These are not the unpaid internships you are looking for.', ref: 'Star Wars: A New Hope (1977)' },
  { line: 'I find your lack of disclosed salary disturbing.', ref: 'Star Wars: The Empire Strikes Back (1980)' },
  { line: 'That is no moon. It is a take-home due Friday.', ref: 'Star Wars: A New Hope (1977)' },
  { line: 'I am inevitable. So is the ATS keyword filter.', ref: 'Avengers: Endgame (2019)' },
  { line: 'I have the high ground. You have the ambiguous "hybrid" policy.', ref: 'Star Wars: Revenge of the Sith (2005)' },
  { line: 'With great responsibility often comes the same pay. Noted.', ref: 'Spider-Man (2002)' },
  { line: 'I am Groot. (Translation: ten years of a three-year-old framework.)', ref: 'Guardians of the Galaxy (2014)' },
  { line: 'Wakanda forever. PTO accrual, less so.', ref: 'Black Panther (2018)' },
  { line: 'This is the way... to read the vesting fine print.', ref: 'The Mandalorian (Disney+, 2019+)' },
  { line: 'The spice must flow. So must the standup notes.', ref: 'Dune (novel, 1965 / films)' },
  { line: 'Fear is the mind-killer. So is a vague "competitive salary."', ref: 'Dune (1984 / 2021)' },
  { line: 'Resistance to buzzwords is futile. You will be assimilated into the culture deck.', ref: 'Star Trek: The Next Generation (1987-1994)' },
  { line: 'Live long and prosper. Remote, if the calendar agrees.', ref: 'Star Trek (1966+)' },
  { line: 'So say we all: align expectations before round six.', ref: 'Battlestar Galactica (2004-2009)' },
  { line: 'The cake is a lie. The "competitive salary" line is also a lie.', ref: 'Portal (Valve, 2007)' },
  { line: 'Shall we play a game? It is called "guess the comp band."', ref: 'WarGames (1983)' },
  { line: 'I choose you, sensible commute... but the gym is in another castle.', ref: 'Pokémon Red/Blue (1996) + Super Mario Bros. (1985)' },
  { line: 'Do or do not. There is no "circle back next quarter."', ref: 'Star Wars: The Empire Strikes Back (1980)' },
  { line: 'It is dangerous to go alone. Take this... LinkedIn Premium trial.', ref: 'The Legend of Zelda (1986)' },
  { line: 'Hadouken! ...is what you shout when you finally submit the form.', ref: 'Street Fighter II (1991)' },
  { line: 'A winner is you! (The winner is still negotiating title level.)', ref: 'Pro Wrestling NES meme / Nintendo' },
  { line: 'Thank you Mario! But our offer is in another castle.', ref: 'Super Mario Bros. (1985)' },
  { line: 'Would you kindly... disclose the salary range?', ref: 'BioShock (2007)' },
  { line: 'War. War never changes. Neither do five-round interview loops.', ref: 'Fallout series (1997+)' },
  { line: 'Hey, you. You are finally awake. You fell asleep reading the benefits PDF.', ref: 'The Elder Scrolls V: Skyrim (2011)' },
  { line: 'I used to be an adventurer like you, then I took an ATS filter to the keyword.', ref: 'The Elder Scrolls V: Skyrim (2011)' },
  { line: 'The right man in the wrong place can make all the difference... in pipeline metrics.', ref: 'Half-Life 2 (2004)' },
  { line: 'Is this a stand-up fight or another bug-bash ticket disguised as a feature?', ref: 'Aliens (1986)' },
  { line: 'I will be back... with the take-home submitted before EOD.', ref: 'The Terminator (1984)' },
  { line: 'I am once again asking for a numeric salary range.', ref: 'Bernie Sanders meme / 2020 U.S. primary' },
  { line: 'This is fine. (It is the third "quick sync" this week.)', ref: 'KC Green comic "On Fire" / internet meme' },
  { line: 'I can haz offer letter?', ref: 'LOLcats / early internet meme' },
  { line: 'One does not simply... parse this PDF without crying.', ref: 'Lord of the Rings / Boromir meme' },
  { line: 'That is what she said... about the JD word count.', ref: 'The Office (US, 2005-2013)' },
  { line: 'Bears. Beets. Battlestar Galactica... and buzzword bingo.', ref: 'The Office (US)' },
  { line: 'How you doin\'? ...with that unpaid trial project?', ref: 'Friends (1994-2004)' },
  { line: 'Pivot! Pivot! PIVOT! (The roadmap just changed again.)', ref: 'Friends (1994-2004)' },
  { line: 'Noice. Smort. Toit. (Still no comp band.)', ref: 'Brooklyn Nine-Nine (2013-2021)' },
  { line: 'Cool cool cool cool cool... absolutely no red flags here.', ref: 'Brooklyn Nine-Nine' },
  { line: 'Treat yo\' self... to a job that lists a salary.', ref: 'Parks and Recreation (2009-2015)' },
  { line: 'I am not superstitious... but I am a little stitious about "unlimited PTO."', ref: 'The Office (US)' },
  { line: 'The rent is too damn high... and so is the years-of-experience bar.', ref: 'Jimmy McMillan / NYC political meme' },
  { line: 'I am in immense pain. (It is the cognitive load of the org chart.)', ref: 'Arthur / PBS Kids meme' },
  { line: 'I am something of a scientist myself... at estimating market bands.', ref: 'Spider-Man (2002)' },
  { line: 'Elementary, Watson: "rockstar" means three people in one chair.', ref: 'Sherlock Holmes (Conan Doyle / many adaptations)' },
  { line: 'We are gonna need a bigger boat... of patience for this hiring loop.', ref: 'Jaws (1975)' },
  { line: 'Hello. My name is Inigo Montoya. You killed my weekend. Prepare to Zoom.', ref: 'The Princess Bride (1987)' },
  { line: 'Inconceivable! ...that "entry-level" requires five years.', ref: 'The Princess Bride (1987)' },
  { line: 'I am not left-handed either... but I am left on read by recruiting.', ref: 'The Princess Bride (1987)' },
  { line: 'Nobody expects the Spanish Inquisition... or a sixth panelist.', ref: 'Monty Python\'s Flying Circus (1969-1974)' },
  { line: 'It is just a flesh wound. (The project is "almost done" since 2022.)', ref: 'Monty Python and the Holy Grail (1975)' },
  { line: 'Bring out yer dead! ...lines of legacy COBOL on the JD.', ref: 'Monty Python and the Holy Grail (1975)' },
  { line: 'What is the airspeed velocity of an unladen swallow? ...is not on the skills matrix.', ref: 'Monty Python and the Holy Grail (1975)' },
  { line: 'Do not Panic. (Have your towel, and your portfolio link.)', ref: 'The Hitchhiker\'s Guide to the Galaxy (1979+)' },
  { line: '42. (Also the number of "nice-to-have" bullets.)', ref: 'The Hitchhiker\'s Guide to the Galaxy' },
  { line: 'So long, and thanks for all the fish... stock options we cannot exercise yet.', ref: 'The Hitchhiker\'s Guide to the Galaxy' },
  { line: 'Talk is cheap. Show me the vesting cliff.', ref: 'Show Me the Money / Jerry Maguire (1996)' },
  { line: 'You had me at "we use Agile correctly."', ref: 'Jerry Maguire (1996)' },
  { line: 'I feel the need... the need for a documented promotion path.', ref: 'Top Gun (1986)' },
  { line: 'I am the captain now... of my own calendar invites.', ref: 'Captain Phillips / film meme (2013)' },
  { line: 'Another happy landing. (It was just the application submitted page.)', ref: 'Star Wars: Revenge of the Sith (2005)' },
  { line: 'It is over Anakin! I have the high ground... on total compensation.', ref: 'Star Wars: Revenge of the Sith (2005)' },
  { line: 'This is the way stocks go... up and to the right, allegedly.', ref: 'Silicon Valley (HBO, 2014-2019)' },
  { line: 'These are not the droids you are hiring for.', ref: 'Star Wars: A New Hope (1977)' },
  { line: 'I am altering the deal. Pray I do not alter it further... (NDA clause 7).', ref: 'Star Wars: The Empire Strikes Back (1980)' },
  { line: 'It is treason, then... to reply-all with salary questions.', ref: 'Star Wars: Revenge of the Sith (2005)' },
  { line: 'I find your lack of WLB disturbing.', ref: 'Star Wars meme / internet' },
  { line: 'The mitochondria is the powerhouse of the cell... and the standup is the powerhouse of sprint guilt.', ref: 'School meme / biology class' },
  { line: 'They are taking the hobbits to Isengard... and the interns to the shadow org.', ref: 'Lord of the Rings / internet remix meme' },
  { line: 'Run, you fools... from vague "ownership mindset" postings.', ref: 'The Lord of the Rings: The Fellowship of the Ring (2001)' },
  { line: 'You shall not pass... go without a technical screen.', ref: 'The Lord of the Rings: The Fellowship of the Ring (2001)' },
  { line: 'Fly, you fools... out of this meeting that could have been an email.', ref: 'The Lord of the Rings: The Fellowship of the Ring (2001)' },
  { line: 'My precious... performance review self-ratings.', ref: 'The Lord of the Rings: The Two Towers (2002)' },
  { line: 'I volunteer as tribute! ...to own the on-call rotation.', ref: 'The Hunger Games (2012)' },
  { line: 'May the odds be ever in your favor... in panel roulette.', ref: 'The Hunger Games (2012)' },
  { line: 'I am inevitable... once the calendar sends the "quick sync."', ref: 'Avengers: Endgame (2019)' },
  { line: 'Perfectly balanced, as all things should be... except the interview panel.', ref: 'Avengers: Infinity War (2018)' },
  { line: 'I love democracy... and also anonymous peer reviews.', ref: 'Star Wars: Attack of the Clones (2002)' },
  { line: 'This is where the fun begins... said nobody about HRIS login.', ref: 'Star Wars: Attack of the Clones (2002)' },
  { line: 'I have a bad feeling about this... JD bullet list.', ref: 'Star Wars (recurring line)' },
  { line: 'Stay awhile and listen... to the recruiter voicemail.', ref: 'Diablo (1996)' },
  { line: 'You must construct additional pylons... of documentation.', ref: 'StarCraft (1998)' },
  { line: 'Zug zug. (Translation: "We should normalize salary threads.")', ref: 'Warcraft / Warcraft III (2002)' },
  { line: 'Job\'s done! ...is what we wish the hiring manager would say.', ref: 'Warcraft III peon voice line' },
  { line: 'A wild recruiter appeared! It used "exciting opportunity." It was super effective?', ref: 'Pokémon (1996+)' },
  { line: 'Press F to pay respects... to the weekend you lost to take-homes.', ref: 'Call of Duty: Advanced Warfare (2014) / meme' },
  { line: 'Git gud... at reading between the lines of "fast-paced environment."', ref: 'Gaming community meme' },
  { line: 'It is not a bug, it is a feature... said the JD about on-call.', ref: 'Software engineering meme' },
  { line: 'It works on my machine... and in my self-assessment narrative.', ref: 'Developer meme' },
  { line: 'I will just leave this here... (the salary spreadsheet leak).', ref: 'The Simpsons / "Steamed Hams" era internet meme' },
  { line: 'Worst trade deal in the history of trade deals... is equity without refreshers.', ref: 'Political meme / internet' },
  { line: 'This is not even my final form... said the scope creep.', ref: 'Dragon Ball Z (1989+)' },
  { line: 'Over 9000! ...keywords in the "nice to have" section.', ref: 'Dragon Ball Z / internet meme' },
  { line: 'Cowabunga, dude... we surfed the layoffs wiki again.', ref: 'Teenage Mutant Ninja Turtles (1987+)' },
  { line: 'To infinity and beyond! ...is the commute if the office is hybrid "3 days".', ref: 'Toy Story (1995)' },
  { line: 'There is no place like home... row, for ergonomic truth.', ref: 'The Wizard of Oz (1939)' },
  { line: 'Follow the yellow brick road... to the careers page that 404s.', ref: 'The Wizard of Oz (1939)' },
  { line: 'I\'ll be back... with references in a single PDF under 2 MB.', ref: 'The Terminator (1984)' },
  { line: 'Hasta la vista, baby... said the contract when you read clause 14.', ref: 'Terminator 2: Judgment Day (1991)' },
  { line: 'Say hello to my little friend... it is the portfolio repo link.', ref: 'Scarface (1983)' },
  { line: 'You talking to me? ...or the ATS parser?', ref: 'Taxi Driver (1976)' },
  { line: 'I am king of the world! ...until the background check asks about that tweet.', ref: 'Titanic (1997)' },
  { line: 'Why so serious? ...about "culture fit" without a rubric.', ref: 'The Dark Knight (2008)' },
  { line: 'Some men just want to watch the world burn... and the sprint board.', ref: 'The Dark Knight (2008)' },
  { line: 'Why did the chicken cross the road? To escape the take-home scope creep.', ref: 'Classic joke / anti-joke' },
  { line: 'To be, or not to be... on-camera for a one-way video interview.', ref: 'Hamlet (Shakespeare, ~1600)' },
  { line: 'Et tu, Brute? ...is what you mutter when the offer is "competitive."', ref: 'Julius Caesar (Shakespeare, ~1599)' },
  { line: 'Rome wasn\'t built in a day... but this MVP was promised in two sprints.', ref: 'Proverb' },
  { line: 'It is a trap! ...said the calendar about the "optional" team dinner.', ref: 'Star Wars: Return of the Jedi (1983)' },
  { line: 'Do. Or do not. There is no try... except trying to parse the equity doc.', ref: 'Star Wars: The Empire Strikes Back (1980)' },
  { line: 'That\'s no moon... it is a 90-minute recruiter screen.', ref: 'Star Wars: A New Hope (1977)' },
];

interface Props {
  /** True while HTTP job search is in flight (no job list yet). */
  fetching: boolean;
  /** Total jobs to evaluate (or an estimate while fetching). */
  total: number;
  /** Jobs already assessed (0 while fetching). */
  assessed: number;
}

export default function AssessmentLoader({ fetching, total, assessed }: Props) {
  const [idx, setIdx] = useState(() => Math.floor(Math.random() * MESSAGES.length));
  const [visible, setVisible] = useState(true);
  const [fetchPulse, setFetchPulse] = useState(11);

  useEffect(() => {
    if (!fetching) return;
    const t = setInterval(() => {
      setFetchPulse(p => (p >= 22 ? 9 : p + 1));
    }, 200);
    return () => clearInterval(t);
  }, [fetching]);

  useEffect(() => {
    const interval = setInterval(() => {
      setVisible(false);
      setTimeout(() => {
        setIdx(i => (i + 1) % MESSAGES.length);
        setVisible(true);
      }, 400);
    }, 4200);
    return () => clearInterval(interval);
  }, []);

  const safeTotal = Math.max(1, total);

  const fillPct = useMemo(() => {
    if (fetching) return fetchPulse;
    return Math.min(100, Math.round((assessed / safeTotal) * 100));
  }, [fetching, assessed, safeTotal, fetchPulse]);

  const showBarIndeterminate = fetching;
  const entry = MESSAGES[idx];

  return (
    <div className="assessment-loader">
      <div className="al-ocean-wrap" aria-hidden>
        <div className="al-ocean-sphere">
          <div
            className="al-ocean-fill-stack"
            style={{ height: `${fillPct}%` }}
          >
            <div className="al-ocean-fluid" />
            <div className="al-ocean-fluid al-ocean-fluid--delay" />
          </div>
          <div className="al-ocean-surface" />
          <div className="al-ocean-glint" />
          <div className="al-ocean-readout" aria-live="polite">
            {fetching ? (
              <>
                <span className="al-ocean-readout-main">...</span>
                <span className="al-ocean-readout-sub">fetching</span>
              </>
            ) : (
              <>
                <div className="al-ocean-readout-row">
                  <span className="al-ocean-readout-main">{assessed}</span>
                  <span className="al-ocean-readout-sep">/</span>
                  <span className="al-ocean-readout-total">{safeTotal}</span>
                </div>
                <span className="al-ocean-readout-sub">evaluated</span>
              </>
            )}
          </div>
        </div>
      </div>

      <div className={`al-message${visible ? ' visible' : ''}`}>
        <p className="al-message-line">{entry.line}</p>
        <p className="al-message-ref">{entry.ref}</p>
      </div>

      <div className="al-progress-label">
        {fetching
          ? 'Fetching listings from job boards...'
          : `Evaluating résumé fit: ${assessed} of ${safeTotal} jobs complete`}
      </div>

      <div className="al-progress-bar">
        <div
          className={`al-progress-fill${showBarIndeterminate ? ' al-progress-fill--indeterminate' : ''}`}
          style={showBarIndeterminate ? undefined : { width: `${fillPct}%` }}
        />
      </div>
    </div>
  );
}
