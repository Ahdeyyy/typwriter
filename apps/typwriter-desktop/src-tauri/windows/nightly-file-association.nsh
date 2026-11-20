; Nightly installs alongside stable and must not take over .typ files from it.
;
; Tauri's APP_ASSOCIATE (FileAssociation.nsh) makes .typ open with this app and
; saves the previous handler in "<FILECLASS>_backup", where FILECLASS is the
; association name in tauri.nightly.conf.json. These hooks run around it to
; give the default back and leave nightly in "Open with" only.
!define NIGHTLY_FILECLASS "Typst document (Nightly)"

!macro NIGHTLY_REFRESH_ASSOCIATIONS
  System::Call "shell32::SHChangeNotify(i 0x08000000, i 0x1000, p 0, p 0)"
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; Hand .typ back to the previous handler (stable) if it still exists, so an
  ; install or update never changes which app opens Typst documents.
  ReadRegStr $R0 SHCTX "Software\Classes\.typ" "${NIGHTLY_FILECLASS}_backup"
  ${If} $R0 != ""
  ${AndIf} $R0 != "${NIGHTLY_FILECLASS}"
    ReadRegStr $R1 SHCTX "Software\Classes\$R0\shell\open\command" ""
    ${If} $R1 != ""
      WriteRegStr SHCTX "Software\Classes\.typ" "" "$R0"
    ${EndIf}
  ${EndIf}
  WriteRegStr SHCTX "Software\Classes\.typ\OpenWithProgids" "${NIGHTLY_FILECLASS}" ""
  !insertmacro NIGHTLY_REFRESH_ASSOCIATIONS
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; APP_UNASSOCIATE resets .typ to our saved backup. If another app (stable,
  ; installed later) is the handler now, keep it instead of restoring an
  ; older value.
  ReadRegStr $R0 SHCTX "Software\Classes\.typ" ""
  ${If} $R0 != "${NIGHTLY_FILECLASS}"
    WriteRegStr SHCTX "Software\Classes\.typ" "${NIGHTLY_FILECLASS}_backup" "$R0"
  ${EndIf}
  DeleteRegValue SHCTX "Software\Classes\.typ\OpenWithProgids" "${NIGHTLY_FILECLASS}"
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegValue SHCTX "Software\Classes\.typ" "${NIGHTLY_FILECLASS}_backup"
  !insertmacro NIGHTLY_REFRESH_ASSOCIATIONS
!macroend
