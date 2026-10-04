# Checks that the prompter's transparent margins let the mouse through to the
# windows underneath, while the island itself becomes interactive on hover.
# Used together with the app smoke test (YALTI_SMOKE_PAUSE_MS). The cursor is
# moved briefly and restored afterwards.
param([Parameter(Mandatory = $true)][string]$WindowJson)

Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class Probe {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint flags);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, int dx, int dy, uint data, UIntPtr extra);
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int index);
  // Real mouse input (unlike SetCursorPos) so hooks and hover tracking see it.
  public static void MoveTo(int x, int y) {
    int w = GetSystemMetrics(0), h = GetSystemMetrics(1);
    mouse_event(0x0001 | 0x8000, (int)(x * 65535.0 / (w - 1)), (int)(y * 65535.0 / (h - 1)), 0, UIntPtr.Zero);
  }
  public static string TitleAt(int x, int y) {
    var p = new POINT { X = x, Y = y };
    var h = GetAncestor(WindowFromPoint(p), 2);
    var sb = new StringBuilder(256);
    GetWindowText(h, sb, 256);
    return sb.ToString();
  }
}
"@

[void][Probe]::SetProcessDPIAware()
$b = Get-Content $WindowJson -Raw | ConvertFrom-Json
# Window bounds are in DIPs; convert to physical pixels for Win32.
Add-Type -AssemblyName System.Windows.Forms
$g = [System.Drawing.Graphics]::FromHwnd([IntPtr]::Zero)
$dpi = $g.DpiX / 96.0
$g.Dispose()
function Px($v) { [int][Math]::Round($v * $dpi) }

$island = @{ X = (Px ($b.x + $b.width / 2)); Y = (Px ($b.y + 90)) }
$margin = @{ X = (Px ($b.x + 12)); Y = (Px ($b.y + $b.height - 12)) }

$saved = New-Object Probe+POINT
[void][Probe]::GetCursorPos([ref]$saved)
$results = [ordered]@{}
try {
  [Probe]::MoveTo($margin.X, $margin.Y); Start-Sleep -Milliseconds 400
  $results.marginBefore = [Probe]::TitleAt($margin.X, $margin.Y)
  [Probe]::MoveTo($island.X, $island.Y); Start-Sleep -Milliseconds 120
  [Probe]::MoveTo($island.X + 3, $island.Y + 2); Start-Sleep -Milliseconds 500
  $results.islandHover = [Probe]::TitleAt($island.X, $island.Y)
  [Probe]::MoveTo($margin.X, $margin.Y); Start-Sleep -Milliseconds 120
  [Probe]::MoveTo($margin.X + 2, $margin.Y - 2); Start-Sleep -Milliseconds 500
  $results.marginAfter = [Probe]::TitleAt($margin.X, $margin.Y)
} finally {
  [void][Probe]::SetCursorPos($saved.X, $saved.Y)
}
$results.dpi = $dpi
$results | ConvertTo-Json
