; Extra steps for the Windows installer (referenced by bundle.windows.nsis.installerHooks in tauri.conf.json).
;
; FRESH INSTALLATIONS ONLY: asks how System Info should behave (run in the background / not / at system startup) and
; stores the answer in %LOCALAPPDATA%\SystemInfo\settings.json, the file the app reads (src/settings.rs). The page is
; never shown for
;   - an update (the in-app updater runs the installer with /UPDATE, passive with /P),
;   - a silent install (/S: no pages at all; the app then asks on its first launch instead),
;   - a machine that already has System Info installed, or already has a saved choice.
; An update therefore never touches the preference or the installer flow it had before.
;
; This file is included BEFORE the template declares its own variables and pages, so it uses only its own variables,
; reads the command line itself, and its page is the first page of a fresh installation.

!include nsDialogs.nsh

Var SIBehavior
Var SIRadioBackground
Var SIRadioOff
Var SIRadioStartup

Page custom SIBehaviorPageShow SIBehaviorPageLeave

Function SIBehaviorPageShow
  ; Update or passive install: not a fresh installation, no question.
  ${GetOptions} $CMDLINE "/UPDATE" $0
  ${IfNot} ${Errors}
    Abort
  ${EndIf}
  ${GetOptions} $CMDLINE "/P" $0
  ${IfNot} ${Errors}
    Abort
  ${EndIf}
  ClearErrors

  ; Already installed (per-user or per-machine) or already answered: keep the existing behaviour, never ask.
  ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\SystemInfo" "DisplayName"
  ${If} $0 != ""
    Abort
  ${EndIf}
  ReadRegStr $0 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\SystemInfo" "DisplayName"
  ${If} $0 != ""
    Abort
  ${EndIf}
  ${If} ${FileExists} "$LOCALAPPDATA\SystemInfo\settings.json"
    Abort
  ${EndIf}

  !insertmacro MUI_HEADER_TEXT "How should System Info run?" "Choose what happens when you close the window and when your computer starts."
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 20u "You can change this at any time in System Info under System > Background and startup."
  Pop $0

  ${NSD_CreateFirstRadioButton} 0 26u 100% 12u "Always run in the background"
  Pop $SIRadioBackground
  ${NSD_CreateLabel} 12u 38u 96% 18u "Closing the window keeps System Info running in the notification area, so history keeps being recorded."
  Pop $0

  ${NSD_CreateAdditionalRadioButton} 0 62u 100% 12u "Do not run in the background"
  Pop $SIRadioOff
  ${NSD_CreateLabel} 12u 74u 96% 18u "Closing the window quits System Info completely. It starts only when you open it."
  Pop $0

  ${NSD_CreateAdditionalRadioButton} 0 98u 100% 12u "Run automatically at system startup"
  Pop $SIRadioStartup
  ${NSD_CreateLabel} 12u 110u 96% 18u "System Info starts when you sign in, minimised to the notification area, and keeps running there."
  Pop $0

  ; The same behaviour as every earlier version is the pre-selected answer.
  ${NSD_Check} $SIRadioOff
  nsDialogs::Show
FunctionEnd

Function SIBehaviorPageLeave
  ${NSD_GetState} $SIRadioBackground $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $SIBehavior "background"
    Return
  ${EndIf}
  ${NSD_GetState} $SIRadioStartup $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $SIBehavior "startup"
    Return
  ${EndIf}
  StrCpy $SIBehavior "off"
FunctionEnd

!macro NSIS_HOOK_POSTINSTALL
  ; $SIBehavior is empty unless the page above was shown and answered, i.e. only on a fresh installation.
  ${If} $SIBehavior != ""
    CreateDirectory "$LOCALAPPDATA\SystemInfo"
    FileOpen $0 "$LOCALAPPDATA\SystemInfo\settings.json" w
    FileWrite $0 '{"schema":1,"behavior":"$SIBehavior"}$\r$\n'
    FileClose $0
    ${If} $SIBehavior == "startup"
      ; Same value the app writes itself (src/autostart.rs); the app reconciles it on every launch.
      WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "SystemInfo" '"$INSTDIR\${MAINBINARYNAME}.exe" --autostart'
    ${EndIf}
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; Uninstalling (not updating) removes the start-at-sign-in entry; the saved preference stays with the user's data.
  ${If} $UpdateMode <> 1
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "SystemInfo"
  ${EndIf}
!macroend
