# Xtranslate 安装脚本（当前用户目录，不需要管理员）
#
# 用法（PowerShell）：
#   irm https://raw.githubusercontent.com/hopechen067/Xtranslate/main/scripts/install.ps1 | iex
#
# 可选环境变量：
#   XTRANSLATE_MIRROR       GitHub 镜像前缀，例如 https://ghproxy.net/
#   XTRANSLATE_INSTALL_DIR  安装目录（默认 %LOCALAPPDATA%\Programs\Xtranslate）
#   XTRANSLATE_NO_DESKTOP   设为 1 则不创建桌面快捷方式
#   XTRANSLATE_NO_LAUNCH    设为 1 则安装完不启动
#
# 对应 GitHub Release 资源名（与 .github/workflows/release-windows.yml 一致）：
#   Xtranslate-portable.exe
#   Xtranslate-Setup.exe
#   SHA256SUMS.txt

$Repo = 'hopechen067/Xtranslate'
$AssetName = 'Xtranslate-portable.exe'
$ChecksumName = 'SHA256SUMS.txt'

function Write-Info([string]$Message) {
  Write-Host "[Xtranslate] $Message"
}

function Write-Err([string]$Message) {
  Write-Host "[Xtranslate] $Message" -ForegroundColor Red
}

function Add-MirrorPrefix([string]$Url) {
  $prefix = [string]$env:XTRANSLATE_MIRROR
  if ([string]::IsNullOrWhiteSpace($prefix)) { return $Url }
  $prefix = $prefix.TrimEnd('/') + '/'
  if ($Url.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { return $Url }
  return $prefix + $Url
}

function New-Shortcut([string]$LinkPath, [string]$TargetPath, [string]$WorkDir) {
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($LinkPath)
  $shortcut.TargetPath = $TargetPath
  $shortcut.WorkingDirectory = $WorkDir
  $shortcut.WindowStyle = 1
  $shortcut.Description = 'Xtranslate'
  $shortcut.IconLocation = "$TargetPath,0"
  $shortcut.Save()
}

$prevEap = $ErrorActionPreference
$prevProgress = $ProgressPreference
try {
  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue'

  try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
  } catch { }

  $headers = @{
    'User-Agent' = 'Xtranslate-installer'
    'Accept'     = 'application/vnd.github+json'
  }

  $apiUrl = Add-MirrorPrefix "https://api.github.com/repos/$Repo/releases/latest"
  $directUrl = Add-MirrorPrefix "https://github.com/$Repo/releases/latest/download/$AssetName"
  $downloadUrl = $null
  $versionLabel = 'latest'
  $expectedHash = $null
  $assetSize = 0

  Write-Info '正在查询最新版本…'
  try {
    $release = Invoke-RestMethod -Uri $apiUrl -Headers $headers
    if ($release.tag_name) { $versionLabel = [string]$release.tag_name }
    $asset = @($release.assets) | Where-Object { $_.name -eq $AssetName } | Select-Object -First 1
    if (-not $asset) {
      $asset = @($release.assets) | Where-Object { $_.name -like 'Xtranslate-portable*.exe' } | Select-Object -First 1
    }
    if ($asset -and $asset.browser_download_url) {
      $downloadUrl = Add-MirrorPrefix ([string]$asset.browser_download_url)
      $assetSize = [int64]$asset.size
    }
    $sumAsset = @($release.assets) | Where-Object { $_.name -eq $ChecksumName } | Select-Object -First 1
    if ($sumAsset -and $sumAsset.browser_download_url) {
      try {
        $sumResp = Invoke-WebRequest -Uri (Add-MirrorPrefix ([string]$sumAsset.browser_download_url)) -UseBasicParsing -Headers $headers
        $sums = $sumResp.Content
        foreach ($line in (($sums -split '\r?\n'))) {
          if ($line -match '^\s*([0-9a-fA-F]{64})\s+\*?' + [regex]::Escape($AssetName) + '\s*$') {
            $expectedHash = $Matches[1].ToLowerInvariant()
            break
          }
        }
      } catch { }
    }
  } catch {
    Write-Info "GitHub API 不可用，改为直接下载。$($_.Exception.Message)"
  }

  if (-not $downloadUrl) { $downloadUrl = $directUrl }

  $installDir = if (-not [string]::IsNullOrWhiteSpace($env:XTRANSLATE_INSTALL_DIR)) {
    $env:XTRANSLATE_INSTALL_DIR
  } else {
    Join-Path $env:LOCALAPPDATA 'Programs\Xtranslate'
  }
  $exePath = Join-Path $installDir 'Xtranslate.exe'
  New-Item -ItemType Directory -Force -Path $installDir | Out-Null
  $tmpPath = Join-Path $installDir ($AssetName + '.download')

  if ($assetSize -gt 0) {
    $mb = [math]::Round($assetSize / 1MB)
    Write-Info "正在下载 $versionLabel  $AssetName（约 $mb MB）…"
  } else {
    Write-Info "正在下载 $versionLabel  $AssetName…"
  }

  try {
    Invoke-WebRequest -Uri $downloadUrl -OutFile $tmpPath -UseBasicParsing -Headers @{ 'User-Agent' = 'Xtranslate-installer' }
  } catch {
    Write-Err "下载失败：$($_.Exception.Message)"
    Write-Err "若在国内，可设置镜像后重试："
    Write-Err "  `$env:XTRANSLATE_MIRROR='https://ghproxy.net/'"
    Write-Err "  irm (`$env:XTRANSLATE_MIRROR + 'https://raw.githubusercontent.com/$Repo/main/scripts/install.ps1') | iex"
    Write-Err "若仓库还没有 Release，作者需要打标签并推送，例如：git tag v0.1.6 && git push origin v0.1.6"
    return
  }

  if (-not (Test-Path -LiteralPath $tmpPath)) {
    Write-Err '下载失败：未得到文件。'
    return
  }

  $actualSize = (Get-Item -LiteralPath $tmpPath).Length
  if ($actualSize -lt 1MB) {
    Write-Err "下载到的文件过小（$actualSize 字节），多半不是安装包。GitHub 可能还没有 Release，或镜像返回了错误页。"
    Write-Err "作者需要推送版本标签才会生成安装包，例如：git tag v0.1.6 && git push origin v0.1.6"
    Remove-Item -LiteralPath $tmpPath -Force -ErrorAction SilentlyContinue
    return
  }

  $actualHash = (Get-FileHash -LiteralPath $tmpPath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($expectedHash -and $actualHash -ne $expectedHash) {
    Write-Err "SHA256 校验失败（期望 $expectedHash，实际 $actualHash）。已删除下载文件。"
    Remove-Item -LiteralPath $tmpPath -Force -ErrorAction SilentlyContinue
    return
  }

  $running = @(Get-Process -Name 'Xtranslate' -ErrorAction SilentlyContinue)
  if ($running.Count -gt 0) {
    Write-Info '正在退出已运行的 Xtranslate…'
    $running | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 800
  }

  Move-Item -LiteralPath $tmpPath -Destination $exePath -Force
  try { Unblock-File -LiteralPath $exePath } catch { }

  $startMenuDir = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
  New-Item -ItemType Directory -Force -Path $startMenuDir | Out-Null
  New-Shortcut (Join-Path $startMenuDir 'Xtranslate.lnk') $exePath $installDir

  if ($env:XTRANSLATE_NO_DESKTOP -ne '1') {
    $desktop = [Environment]::GetFolderPath('Desktop')
    if ($desktop) {
      New-Shortcut (Join-Path $desktop 'Xtranslate.lnk') $exePath $installDir
    }
  }

  Write-Info "安装完成：$exePath"
  Write-Info '开始菜单已添加快捷方式。程序在系统托盘（右下角，可能在 ^ 折叠区），按 Alt+Q 呼出。'
  Write-Info '若 Windows 提示“未识别的应用”，选“更多信息”→“仍要运行”。'

  if ($env:XTRANSLATE_NO_LAUNCH -ne '1') {
    Start-Process -FilePath $exePath -WorkingDirectory $installDir
  }
} catch {
  Write-Err "安装失败：$($_.Exception.Message)"
  Write-Err "国内用户可设置 `$env:XTRANSLATE_MIRROR='https://ghproxy.net/' 后重试。"
} finally {
  $ErrorActionPreference = $prevEap
  $ProgressPreference = $prevProgress
}
