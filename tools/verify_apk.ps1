Add-Type -AssemblyName System.IO.Compression.FileSystem
$apk = "android\app\build\outputs\apk\debug\Skalee-Validades-Titanium-Glass-2.3-debug.apk"
$zip = [System.IO.Compression.ZipFile]::OpenRead((Resolve-Path $apk))
foreach ($e in $zip.Entries) {
  if ($e.FullName -eq "assets/public/android-ui.js") {
    $s = $e.Open()
    $r = New-Object System.IO.StreamReader($s)
    $t = $r.ReadToEnd()
    $hasDet = $t.Contains("androidWebGLDiagDetails")
    $hasRes = $t.Contains("restoreWebGL")
    $hasSim = $t.Contains("simulateWebGLLoss")
    Write-Output "JS in APK: Length=$($t.Length) | hasDetails=$hasDet | hasRestore=$hasRes | hasSimulate=$hasSim"
    $r.Close()
    $s.Close()
  }
  if ($e.FullName -eq "assets/public/android-ui.css") {
    $s = $e.Open()
    $r = New-Object System.IO.StreamReader($s)
    $t = $r.ReadToEnd()
    $hasDiag = $t.Contains("android-webgl-diag-details")
    $hasRad = $t.Contains("radial-gradient")
    Write-Output "CSS in APK: Length=$($t.Length) | hasDiagDetails=$hasDiag | hasRadialGradient=$hasRad"
    $r.Close()
    $s.Close()
  }
}
$zip.Dispose()

