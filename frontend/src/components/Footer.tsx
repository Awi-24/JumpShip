export default function Footer() {
  return (
    <footer className="border-t border-taupe-100 bg-white/80 py-4 mt-auto">
      <div className="max-w-7xl mx-auto px-6 sm:px-10 flex items-center justify-between text-xs text-taupe">
        <span>
          Jumpship · baseado em{" "}
          <a
            href="https://github.com/Bunsly/JobSpy"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-coral transition-colors"
          >
            python-jobspy
          </a>
        </span>
        <span className="text-taupe-400">Use burn accounts. Verifique os ToS das plataformas.</span>
      </div>
    </footer>
  );
}
