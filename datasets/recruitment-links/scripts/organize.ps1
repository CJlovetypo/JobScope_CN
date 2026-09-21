param([string]$Repository = (Resolve-Path "$PSScriptRoot/../../..").Path)
$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath($Repository).TrimEnd('\','/')
$datasetRoot = Join-Path $repoRoot 'datasets/recruitment-links'
$names = @('feishu-source-expansion-20260919','wps-campus-sources-20260919','waiqi-2026-09-20','waiqi-candidate-review','waiqi-expansion-followup','waiqi-interface-deep-review')
New-Item -ItemType Directory -Path (Join-Path $datasetRoot 'collections') -Force | Out-Null
foreach ($name in $names) {
    $source = [IO.Path]::GetFullPath((Join-Path $repoRoot "campus-job-fit/artifacts/$name"))
    $target = [IO.Path]::GetFullPath((Join-Path $datasetRoot "collections/$name"))
    # Validate both absolute paths before moving any directory.
    if (-not $source.StartsWith($repoRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or
        -not $target.StartsWith($repoRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Path escapes repository' }
    if (Test-Path -LiteralPath $source) {
        $item = Get-Item -LiteralPath $source -Force
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
            if ([IO.Path]::GetFullPath($item.Target).TrimEnd('\') -ne $target.TrimEnd('\')) { throw "Unexpected junction: $source" }
            Write-Output "Already organized: $name"
            continue
        }
        if (Test-Path -LiteralPath $target) { throw "Destination exists; refusing to merge: $target" }
        Move-Item -LiteralPath $source -Destination $target
    } elseif (-not (Test-Path -LiteralPath $target)) { throw "Missing collection: $name" }
    # Recoverable if interrupted after the move: the next run recreates the junction.
    New-Item -ItemType Junction -Path $source -Target $target | Out-Null
    Write-Output "Organized: $name"
}
