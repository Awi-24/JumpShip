; Installer look (tauri.conf.json bundle.windows.nsis.installerHooks). Tauri includes this file before the MUI pages,
; so these MUI2 defines apply: dark welcome / finish pages and header in the app's amber, like its terminal window.
!define MUI_BGCOLOR "0B0B0A"
!define MUI_TEXTCOLOR "F5A623"
!define MUI_HEADERIMAGE_RIGHT
!define MUI_INSTFILESPAGE_COLORS "F5A623 0B0B0A"
!define MUI_WELCOMEPAGE_TITLE "JumpShip"
!define MUI_WELCOMEPAGE_TEXT "> local-first AI job search$\r$\n$\r$\nSearches the job boards, scores every opening against your résumé with your own AI model and writes tailored résumés.$\r$\n$\r$\nClick Next to install."
!define MUI_FINISHPAGE_TITLE "Ready."
