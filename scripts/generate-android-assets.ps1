param(
    [string]$ResourceRoot = (Join-Path $PSScriptRoot '..\android\app\src\main\res')
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$navy = [System.Drawing.Color]::FromArgb(255, 8, 18, 43)
$blue = [System.Drawing.Color]::FromArgb(255, 48, 104, 234)
$cyan = [System.Drawing.Color]::FromArgb(255, 76, 214, 255)
$white = [System.Drawing.Color]::FromArgb(255, 245, 249, 255)
$transparent = [System.Drawing.Color]::FromArgb(0, 0, 0, 0)

function New-Canvas([int]$width, [int]$height, [System.Drawing.Color]$background) {
    $bitmap = [System.Drawing.Bitmap]::new($width, $height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $graphics.Clear($background)
    return @{ Bitmap = $bitmap; Graphics = $graphics }
}

function New-RoundedPath([System.Drawing.RectangleF]$rect, [float]$radius) {
    $diameter = $radius * 2
    $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
    $path.AddArc($rect.X, $rect.Y, $diameter, $diameter, 180, 90)
    $path.AddArc($rect.Right - $diameter, $rect.Y, $diameter, $diameter, 270, 90)
    $path.AddArc($rect.Right - $diameter, $rect.Bottom - $diameter, $diameter, $diameter, 0, 90)
    $path.AddArc($rect.X, $rect.Bottom - $diameter, $diameter, $diameter, 90, 90)
    $path.CloseFigure()
    return $path
}

function Draw-Mark($graphics, [float]$x, [float]$y, [float]$size, [bool]$withBackground, [bool]$roundBackground) {
    if ($withBackground) {
        $backgroundRect = [System.Drawing.RectangleF]::new($x, $y, $size, $size)
        $brush = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
            $backgroundRect,
            $navy,
            $blue,
            45
        )
        if ($roundBackground) {
            $graphics.FillEllipse($brush, $backgroundRect)
        } else {
            $path = New-RoundedPath $backgroundRect ($size * 0.23)
            $graphics.FillPath($brush, $path)
            $path.Dispose()
        }
        $brush.Dispose()
    }

    $font = [System.Drawing.Font]::new('Segoe UI', $size * 0.31, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $textBrush = [System.Drawing.SolidBrush]::new($white)
    $format = [System.Drawing.StringFormat]::new()
    $format.Alignment = [System.Drawing.StringAlignment]::Center
    $format.LineAlignment = [System.Drawing.StringAlignment]::Center
    $textRect = [System.Drawing.RectangleF]::new($x + $size * 0.12, $y + $size * 0.13, $size * 0.76, $size * 0.55)
    $graphics.DrawString('MS', $font, $textBrush, $textRect, $format)

    $pen = [System.Drawing.Pen]::new($cyan, [Math]::Max(2, $size * 0.045))
    $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $points = [System.Drawing.PointF[]]@(
        [System.Drawing.PointF]::new($x + $size * 0.20, $y + $size * 0.72),
        [System.Drawing.PointF]::new($x + $size * 0.37, $y + $size * 0.72),
        [System.Drawing.PointF]::new($x + $size * 0.44, $y + $size * 0.61),
        [System.Drawing.PointF]::new($x + $size * 0.53, $y + $size * 0.82),
        [System.Drawing.PointF]::new($x + $size * 0.62, $y + $size * 0.67),
        [System.Drawing.PointF]::new($x + $size * 0.69, $y + $size * 0.72),
        [System.Drawing.PointF]::new($x + $size * 0.80, $y + $size * 0.72)
    )
    $graphics.DrawLines($pen, $points)

    $pen.Dispose()
    $format.Dispose()
    $textBrush.Dispose()
    $font.Dispose()
}

function Save-Png($canvas, [string]$path) {
    $directory = Split-Path -Parent $path
    if (-not (Test-Path -LiteralPath $directory)) {
        New-Item -ItemType Directory -Path $directory | Out-Null
    }
    $canvas.Bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $canvas.Graphics.Dispose()
    $canvas.Bitmap.Dispose()
}

$densities = @{
    'mdpi' = 1.0
    'hdpi' = 1.5
    'xhdpi' = 2.0
    'xxhdpi' = 3.0
    'xxxhdpi' = 4.0
}

foreach ($entry in $densities.GetEnumerator()) {
    $density = $entry.Key
    $scale = [double]$entry.Value
    $legacySize = [int](48 * $scale)
    $foregroundSize = [int](108 * $scale)

    $icon = New-Canvas $legacySize $legacySize $transparent
    Draw-Mark $icon.Graphics 0 0 $legacySize $true $false
    Save-Png $icon (Join-Path $ResourceRoot "mipmap-$density\ic_launcher.png")

    $round = New-Canvas $legacySize $legacySize $transparent
    Draw-Mark $round.Graphics 0 0 $legacySize $true $true
    Save-Png $round (Join-Path $ResourceRoot "mipmap-$density\ic_launcher_round.png")

    $foreground = New-Canvas $foregroundSize $foregroundSize $transparent
    $markSize = $foregroundSize * 0.66
    $markOffset = ($foregroundSize - $markSize) / 2
    Draw-Mark $foreground.Graphics $markOffset $markOffset $markSize $false $false
    Save-Png $foreground (Join-Path $ResourceRoot "mipmap-$density\ic_launcher_foreground.png")
}

$splashTargets = @(
    @{ Folder = 'drawable'; Width = 480; Height = 320 },
    @{ Folder = 'drawable-land-mdpi'; Width = 480; Height = 320 },
    @{ Folder = 'drawable-land-hdpi'; Width = 800; Height = 480 },
    @{ Folder = 'drawable-land-xhdpi'; Width = 1280; Height = 720 },
    @{ Folder = 'drawable-land-xxhdpi'; Width = 1600; Height = 960 },
    @{ Folder = 'drawable-land-xxxhdpi'; Width = 1920; Height = 1280 },
    @{ Folder = 'drawable-port-mdpi'; Width = 320; Height = 480 },
    @{ Folder = 'drawable-port-hdpi'; Width = 480; Height = 800 },
    @{ Folder = 'drawable-port-xhdpi'; Width = 720; Height = 1280 },
    @{ Folder = 'drawable-port-xxhdpi'; Width = 960; Height = 1600 },
    @{ Folder = 'drawable-port-xxxhdpi'; Width = 1280; Height = 1920 }
)

foreach ($target in $splashTargets) {
    $canvas = New-Canvas $target.Width $target.Height $navy
    $shortEdge = [Math]::Min($target.Width, $target.Height)
    $markSize = $shortEdge * 0.30
    $markX = ($target.Width - $markSize) / 2
    $markY = ($target.Height - $markSize) / 2 - ($shortEdge * 0.06)
    Draw-Mark $canvas.Graphics $markX $markY $markSize $true $false

    $titleFont = [System.Drawing.Font]::new('Segoe UI', $shortEdge * 0.055, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $titleBrush = [System.Drawing.SolidBrush]::new($white)
    $titleFormat = [System.Drawing.StringFormat]::new()
    $titleFormat.Alignment = [System.Drawing.StringAlignment]::Center
    $titleRect = [System.Drawing.RectangleF]::new(0, $markY + $markSize + $shortEdge * 0.045, $target.Width, $shortEdge * 0.10)
    $canvas.Graphics.DrawString('Migraine Signal', $titleFont, $titleBrush, $titleRect, $titleFormat)
    $titleFormat.Dispose()
    $titleBrush.Dispose()
    $titleFont.Dispose()

    Save-Png $canvas (Join-Path $ResourceRoot "$($target.Folder)\splash.png")
}

Write-Host "Generated Migraine Signal Android assets in $ResourceRoot"
