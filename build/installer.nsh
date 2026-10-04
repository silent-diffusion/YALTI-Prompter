; Custom steps for the YALTI Prompter installer (electron-builder includes this
; file automatically; see "nsis.include" in package.json).
;
; When YALTI Prompter is already installed, the installer opens with a choice:
;   - install this version over it (update, repair or replace),
;   - open the installed app and check GitHub for updates instead, or
;   - uninstall it.
; Silent installs (the app's own updater runs "--updated /S"), the elevated
; second pass of a per-machine install and fresh installs skip the page.
;
; Only defines that electron-builder passes to makensis are used here
; (APP_GUID, UNINSTALL_APP_KEY, PRODUCT_NAME, PRODUCT_FILENAME, VERSION), and
; every variable and function is used: electron-builder treats NSIS warnings
; as errors. This page comes before any Modern UI page, so MUI's own variables
; (MUI_HEADER_TEXT) don't exist yet; the header is set directly.

!macro customWelcomePage
  !ifndef BUILD_UNINSTALLER
    !include LogicLib.nsh
    !include nsDialogs.nsh
    !include FileFunc.nsh
    !include WordFunc.nsh

    ; Where electron-builder records an installation (per user or per machine).
    !define YALTI_INSTALL_KEY "Software\${APP_GUID}"
    !define YALTI_UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}"
    ; The newest version without an updater (it ignores --check-updates).
    !define YALTI_LAST_WITHOUT_UPDATER "1.0.0"

    Var yaltiDir
    Var yaltiVersion
    Var yaltiUninstall
    Var yaltiRadioInstall
    Var yaltiRadioCheck
    Var yaltiRadioUninstall

    Page custom yaltiExistingCreate yaltiExistingLeave

    Function yaltiFindExisting
      StrCpy $yaltiDir ""
      StrCpy $yaltiVersion ""
      StrCpy $yaltiUninstall ""
      ReadRegStr $yaltiDir HKCU "${YALTI_INSTALL_KEY}" InstallLocation
      ${If} $yaltiDir != ""
        ReadRegStr $yaltiVersion HKCU "${YALTI_UNINSTALL_KEY}" DisplayVersion
        ReadRegStr $yaltiUninstall HKCU "${YALTI_UNINSTALL_KEY}" UninstallString
      ${Else}
        ReadRegStr $yaltiDir HKLM "${YALTI_INSTALL_KEY}" InstallLocation
        ReadRegStr $yaltiVersion HKLM "${YALTI_UNINSTALL_KEY}" DisplayVersion
        ReadRegStr $yaltiUninstall HKLM "${YALTI_UNINSTALL_KEY}" UninstallString
      ${EndIf}
      ; A registry entry left behind by a deleted folder doesn't count.
      ${If} $yaltiDir != ""
        ${IfNot} ${FileExists} "$yaltiDir\${PRODUCT_FILENAME}.exe"
          StrCpy $yaltiDir ""
        ${EndIf}
      ${EndIf}
    FunctionEnd

    Function yaltiExistingCreate
      ; Updates started by the app pass --updated; they never ask.
      ${GetParameters} $R0
      ClearErrors
      ${GetOptions} $R0 "--updated" $R1
      ${IfNot} ${Errors}
        Abort
      ${EndIf}
      !ifdef UAC_IsInnerInstance
        ${If} ${UAC_IsInnerInstance}
          Abort
        ${EndIf}
      !endif
      Call yaltiFindExisting
      ${If} $yaltiDir == ""
        Abort
      ${EndIf}

      ; 0: same version, 1: the installed one is newer, 2: this installer is newer.
      ${VersionCompare} "$yaltiVersion" "${VERSION}" $R2
      ${If} $R2 == 0
        StrCpy $R3 "&Reinstall version ${VERSION}"
        StrCpy $R4 "Repairs the installed copy. Your settings and scripts are kept."
      ${ElseIf} $R2 == 1
        StrCpy $R3 "&Replace it with version ${VERSION} (older)"
        StrCpy $R4 "Goes back to this older version. Your settings and scripts are kept."
      ${Else}
        StrCpy $R3 "&Update to version ${VERSION}"
        StrCpy $R4 "Installs this version over the old one. Your settings and scripts are kept."
      ${EndIf}

      ; Header title (1037) and subtitle (1038) of the installer window.
      GetDlgItem $0 $HWNDPARENT 1037
      SendMessage $0 ${WM_SETTEXT} 0 "STR:${PRODUCT_NAME} is already installed"
      GetDlgItem $0 $HWNDPARENT 1038
      SendMessage $0 ${WM_SETTEXT} 0 "STR:Choose what you would like to do."

      nsDialogs::Create 1018
      Pop $0
      ${If} $0 == error
        Abort
      ${EndIf}

      ${NSD_CreateLabel} 0 0 100% 20u "${PRODUCT_NAME} $yaltiVersion is installed in $yaltiDir."
      Pop $0

      ${NSD_CreateRadioButton} 0 28u 100% 12u "$R3"
      Pop $yaltiRadioInstall
      ${NSD_CreateLabel} 12u 41u -12u 16u "$R4"
      Pop $0

      ; Copies from before the updater can't check for updates themselves.
      ${VersionCompare} "$yaltiVersion" "${YALTI_LAST_WITHOUT_UPDATER}" $R5
      ${If} $R5 == 1
        StrCpy $R6 "Opens ${PRODUCT_NAME} and checks GitHub for the newest version."
      ${Else}
        StrCpy $R6 "Not available: version $yaltiVersion can't check for updates by itself."
      ${EndIf}
      ${NSD_CreateRadioButton} 0 64u 100% 12u "&Check for updates instead"
      Pop $yaltiRadioCheck
      ${NSD_CreateLabel} 12u 77u -12u 16u "$R6"
      Pop $0
      ${If} $R5 != 1
        EnableWindow $yaltiRadioCheck 0
      ${EndIf}

      ${NSD_CreateRadioButton} 0 100u 100% 12u "&Uninstall ${PRODUCT_NAME}"
      Pop $yaltiRadioUninstall
      ${NSD_CreateLabel} 12u 113u -12u 16u "Removes the app. Your settings stay in your user folder."
      Pop $0

      ${NSD_Check} $yaltiRadioInstall
      nsDialogs::Show
    FunctionEnd

    Function yaltiExistingLeave
      ${NSD_GetState} $yaltiRadioCheck $0
      ${If} $0 == ${BST_CHECKED}
        ; Opens a running copy's update page too (it is a single-instance app).
        Exec '"$yaltiDir\${PRODUCT_FILENAME}.exe" --check-updates'
        SetErrorLevel 0
        Quit
      ${EndIf}
      ${NSD_GetState} $yaltiRadioUninstall $0
      ${If} $0 == ${BST_CHECKED}
        ${If} $yaltiUninstall == ""
          StrCpy $yaltiUninstall '"$yaltiDir\Uninstall ${PRODUCT_FILENAME}.exe"'
        ${EndIf}
        Exec $yaltiUninstall
        SetErrorLevel 0
        Quit
      ${EndIf}
    FunctionEnd
  !endif
!macroend
