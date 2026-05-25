Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = 'Stop'

$iconDir = Join-Path $PSScriptRoot '..\src-tauri\icons'
$pngPath = Join-Path $iconDir 'icon.png'
$icoPath = Join-Path $iconDir 'icon.ico'
$sizes = @(16, 24, 32, 48, 64, 128, 256)

function Get-PngBytes {
  param([System.Drawing.Bitmap]$Bitmap)

  $stream = New-Object System.IO.MemoryStream
  $Bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
  return $stream.ToArray()
}

function Write-Ico {
  param(
    [string]$Path,
    [byte[][]]$Images,
    [int[]]$ImageSizes
  )

  $stream = [System.IO.File]::Create($Path)
  $writer = New-Object System.IO.BinaryWriter $stream
  $writer.Write([UInt16]0)
  $writer.Write([UInt16]1)
  $writer.Write([UInt16]$Images.Length)

  $offset = 6 + (16 * $Images.Length)
  for ($index = 0; $index -lt $Images.Length; $index += 1) {
    $size = $ImageSizes[$index]
    $encodedSize = [byte]0
    if ($size -lt 256) {
      $encodedSize = [byte]$size
    }
    $writer.Write($encodedSize)
    $writer.Write($encodedSize)
    $writer.Write([byte]0)
    $writer.Write([byte]0)
    $writer.Write([UInt16]1)
    $writer.Write([UInt16]32)
    $writer.Write([UInt32]$Images[$index].Length)
    $writer.Write([UInt32]$offset)
    $offset += $Images[$index].Length
  }

  foreach ($image in $Images) {
    $writer.Write($image)
  }

  $writer.Dispose()
  $stream.Dispose()
}

function Convert-ImageToIcon {
  param(
    [string]$SourcePath,
    [string]$PngPath,
    [string]$IcoPath
  )

  Copy-Item -LiteralPath $SourcePath -Destination $PngPath -Force
  $sourceImage = [System.Drawing.Image]::FromFile($SourcePath)
  $images = New-Object 'System.Collections.Generic.List[byte[]]'

  foreach ($size in $sizes) {
    $bitmap = [System.Drawing.Bitmap]::new($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.Clear([System.Drawing.Color]::Transparent)
    $graphics.DrawImage($sourceImage, [System.Drawing.Rectangle]::new(0, 0, $size, $size))
    $images.Add((Get-PngBytes $bitmap))
    $graphics.Dispose()
    $bitmap.Dispose()
  }

  $sourceImage.Dispose()
  Write-Ico -Path $IcoPath -Images $images.ToArray() -ImageSizes $sizes
}

$sourceIcon = Get-ChildItem -LiteralPath 'D:\Download\Browser' -Filter '*23_01_53.png' |
  Select-Object -First 1

if ($sourceIcon) {
  Convert-ImageToIcon -SourcePath $sourceIcon.FullName -PngPath $pngPath -IcoPath $icoPath
  return
}

throw '未找到用户提供的图标源图：D:\Download\Browser\*23_01_53.png'
