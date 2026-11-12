; Keep ZenTrap settings and the managed Roblox installation outside the folder
; temporarily deleted by NSIS when it replaces an older version.

!macro ZTRestoreDirectory NAME
  ${if} ${FileExists} "$R9\${NAME}\*.*"
    ${ifNot} ${FileExists} "$INSTDIR\${NAME}\*.*"
      RMDir "$INSTDIR\${NAME}"
      ClearErrors
      Rename "$R9\${NAME}" "$INSTDIR\${NAME}"
    ${endIf}
  ${endIf}
!macroend

!macro ZTRestoreFile NAME
  ${if} ${FileExists} "$R9\${NAME}"
    ${ifNot} ${FileExists} "$INSTDIR\${NAME}"
      ClearErrors
      Rename "$R9\${NAME}" "$INSTDIR\${NAME}"
    ${endIf}
  ${endIf}
!macroend

!macro ZTRestoreUserData
  !insertmacro ZTRestoreDirectory "ZenTrapData"
  !insertmacro ZTRestoreDirectory "Versions"
  !insertmacro ZTRestoreDirectory "Downloads"
  !insertmacro ZTRestoreDirectory "Logs"
  !insertmacro ZTRestoreDirectory "CustomThemes"
  !insertmacro ZTRestoreDirectory "Modifications"
  !insertmacro ZTRestoreFile "ZenTrap.Install.json"
  !insertmacro ZTRestoreFile "Settings.json"
  !insertmacro ZTRestoreFile "State.json"
  !insertmacro ZTRestoreFile "PlayerState.json"
  !insertmacro ZTRestoreFile "RobloxState.json"
  !insertmacro ZTRestoreFile "RobloxState.json.bak"
  !insertmacro ZTRestoreFile "StudioState.json"
  !insertmacro ZTRestoreFile "Bloxstrap.exe"
!macroend

!macro ZTPreserveDirectory NAME
  ${if} ${FileExists} "$INSTDIR\${NAME}\*.*"
    ClearErrors
    Rename "$INSTDIR\${NAME}" "$R9\${NAME}"
    ${if} ${Errors}
      !insertmacro ZTRestoreUserData
      Abort `Could not preserve ${NAME}; update cancelled to protect user data.`
    ${endIf}
  ${endIf}
!macroend

!macro ZTPreserveFile NAME
  ${if} ${FileExists} "$INSTDIR\${NAME}"
    ClearErrors
    Rename "$INSTDIR\${NAME}" "$R9\${NAME}"
    ${if} ${Errors}
      !insertmacro ZTRestoreUserData
      Abort `Could not preserve ${NAME}; update cancelled to protect user data.`
    ${endIf}
  ${endIf}
!macroend

!macro ZTPreserveUserData
  !insertmacro ZTPreserveDirectory "ZenTrapData"
  !insertmacro ZTPreserveDirectory "Versions"
  !insertmacro ZTPreserveDirectory "Downloads"
  !insertmacro ZTPreserveDirectory "Logs"
  !insertmacro ZTPreserveDirectory "CustomThemes"
  !insertmacro ZTPreserveDirectory "Modifications"
  !insertmacro ZTPreserveFile "ZenTrap.Install.json"
  !insertmacro ZTPreserveFile "Settings.json"
  !insertmacro ZTPreserveFile "State.json"
  !insertmacro ZTPreserveFile "PlayerState.json"
  !insertmacro ZTPreserveFile "RobloxState.json"
  !insertmacro ZTPreserveFile "RobloxState.json.bak"
  !insertmacro ZTPreserveFile "StudioState.json"
  !insertmacro ZTPreserveFile "Bloxstrap.exe"
  FileOpen $R8 "$R9\.zentrap-preserved" w
  FileWrite $R8 "1"
  FileClose $R8
!macroend

; Runs in the new installer before it launches the old version's uninstaller.
; This protects users upgrading from releases that had the default recursive NSIS cleanup.
!macro customInit
  ${if} ${isUpdated}
    StrCpy $R9 "$INSTDIR\..\${APP_ID}-update-preserve"
    !insertmacro ZTRestoreUserData
    Delete "$R9\.zentrap-preserved"
    RMDir "$R9"
    ${if} ${FileExists} "$R9\*.*"
      Abort `A previous update backup could not be restored. ZenTrap was left untouched.`
    ${endIf}
    CreateDirectory "$R9"
    !insertmacro ZTPreserveUserData
  ${endIf}
!macroend

; Also protects updates launched directly through the installed uninstaller.
!macro customRemoveFiles
  ${if} ${isUpdated}
    StrCpy $R9 "$INSTDIR\..\${APP_ID}-update-preserve"
    ${ifNot} ${FileExists} "$R9\.zentrap-preserved"
      RMDir "$R9"
      ${if} ${FileExists} "$R9\*.*"
        Abort `A previous update backup could not be restored. ZenTrap was left untouched.`
      ${endIf}
      CreateDirectory "$R9"
      !insertmacro ZTPreserveUserData
    ${endIf}

    CreateDirectory "$PLUGINSDIR\old-install"
    Push ""
    Call un.atomicRMDir
    Pop $R0
    ${if} $R0 != 0
      DetailPrint "File is busy, aborting: $R0"
      Push ""
      Call un.restoreFiles
      Pop $R0
      !insertmacro ZTRestoreUserData
      Delete "$R9\.zentrap-preserved"
      RMDir "$R9"
      Abort `Could not replace the existing ZenTrap files. User data was restored.`
    ${endIf}

    SetOutPath $TEMP
    RMDir /r $INSTDIR
  ${else}
    SetOutPath $TEMP
    RMDir /r $INSTDIR
  ${endIf}
!macroend

!macro customInstall
  StrCpy $R9 "$INSTDIR\..\${APP_ID}-update-preserve"
  !insertmacro ZTRestoreUserData
  Delete "$R9\.zentrap-preserved"
  RMDir "$R9"
!macroend
