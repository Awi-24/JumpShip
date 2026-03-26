"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import clsx from "clsx";

const navItems = [
  { href: "/", label: "Buscar" },
  { href: "/resume", label: "Currículo" },
  { href: "/dashboard", label: "Candidaturas" },
  { href: "/concursos", label: "Concursos" },
  { href: "/settings", label: "Configurações" },
];

export default function Navbar() {
  const pathname = usePathname();

  return (
    <nav className="bg-white/95 backdrop-blur-md border-b border-taupe-100 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-6 sm:px-10">
        <div className="flex items-center h-[60px] gap-10">

          {/* Logo apenas — sem texto */}
          <Link href="/" className="flex-shrink-0 opacity-90 hover:opacity-100 transition-opacity">
            <Image
              src="/logo.png"
              alt="Jumpship"
              width={32}
              height={32}
              className="rounded-xl object-contain"
              priority
            />
          </Link>

          {/* Links de navegação — estilo Apple/Google: só texto, sem ícones */}
          <div className="flex items-center gap-0.5">
            {navItems.map(({ href, label }) => {
              const active = pathname === href || (href !== "/" && pathname.startsWith(href));
              return (
                <Link
                  key={href}
                  href={href}
                  className={clsx(
                    "relative px-3.5 py-1.5 text-sm rounded-lg transition-colors duration-150",
                    active
                      ? "text-gray-900 font-medium"
                      : "text-taupe-500 font-normal hover:text-gray-800"
                  )}
                >
                  {label}
                  {/* Underline ativo sutil — como Apple */}
                  {active && (
                    <span className="absolute bottom-0 left-3.5 right-3.5 h-[2px] bg-coral rounded-full" />
                  )}
                </Link>
              );
            })}
          </div>

        </div>
      </div>
    </nav>
  );
}
