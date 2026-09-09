<#
.SYNOPSIS
    Controls the project-local PostgreSQL 16 cluster (no system install, no admin).

.DESCRIPTION
    This machine has neither Docker nor a system PostgreSQL, so the backend uses
    a self-contained cluster under %LOCALAPPDATA%\rehab-hms-pg. Delete that
    folder to remove every trace of it.

.EXAMPLE
    .\scripts\pg.ps1 start
    .\scripts\pg.ps1 status
    .\scripts\pg.ps1 psql
    .\scripts\pg.ps1 stop
#>
param(
    [Parameter(Position = 0)]
    [ValidateSet('start', 'stop', 'restart', 'status', 'psql', 'logs', 'reset')]
    [string]$Command = 'status'
)

$ErrorActionPreference = 'Stop'

$Root = Join-Path $env:LOCALAPPDATA 'rehab-hms-pg'
$Bin  = Join-Path $Root 'pgsql\bin'
$Data = Join-Path $Root 'data'
$Log  = Join-Path $Root 'postgres.log'
$Port = 5432
$Db   = 'rehab_hms'

if (-not (Test-Path $Bin)) {
    Write-Error "PostgreSQL binaries not found at $Bin. See backend/README.md for setup."
    exit 1
}

$env:PGPASSWORD = 'postgres'

switch ($Command) {
    'start' {
        & "$Bin\pg_ctl.exe" -D $Data -l $Log -o "-p $Port" start
        Start-Sleep -Seconds 3
        & "$Bin\pg_isready.exe" -h localhost -p $Port
    }
    'stop' {
        & "$Bin\pg_ctl.exe" -D $Data -m fast stop
    }
    'restart' {
        & "$Bin\pg_ctl.exe" -D $Data -m fast stop
        Start-Sleep -Seconds 2
        & "$Bin\pg_ctl.exe" -D $Data -l $Log -o "-p $Port" start
        Start-Sleep -Seconds 3
        & "$Bin\pg_isready.exe" -h localhost -p $Port
    }
    'status' {
        & "$Bin\pg_isready.exe" -h localhost -p $Port
        & "$Bin\pg_ctl.exe" -D $Data status
    }
    'psql' {
        & "$Bin\psql.exe" -U postgres -h localhost -p $Port -d $Db
    }
    'logs' {
        if (Test-Path $Log) { Get-Content $Log -Tail 40 } else { Write-Output "No log at $Log" }
    }
    'reset' {
        Write-Warning "This DROPS and recreates the '$Db' database. All data is lost."
        $confirm = Read-Host "Type the database name to confirm"
        if ($confirm -ne $Db) { Write-Output 'Cancelled.'; break }
        & "$Bin\dropdb.exe"   -U postgres -h localhost -p $Port --if-exists $Db
        & "$Bin\createdb.exe" -U postgres -h localhost -p $Port $Db
        Write-Output "Recreated $Db. Run 'alembic upgrade head' next."
    }
}
