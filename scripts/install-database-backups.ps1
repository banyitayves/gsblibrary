$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$node = (Get-Command node.exe -ErrorAction Stop).Source
$backupScript = Join-Path $projectRoot 'backend\src\backupDatabase.js'
$principal = New-ScheduledTaskPrincipal `
    -UserId "$env:USERDOMAIN\$env:USERNAME" `
    -LogonType Interactive `
    -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 30)
$action = New-ScheduledTaskAction `
    -Execute $node `
    -Argument "`"$backupScript`"" `
    -WorkingDirectory $projectRoot

$dailyTrigger = New-ScheduledTaskTrigger -Daily -At '2:00 AM'
Register-ScheduledTask `
    -TaskName 'LibraryFlow Database Backup - Daily' `
    -Description 'Creates a daily MySQL backup for the LibraryFlow database.' `
    -Action $action `
    -Trigger $dailyTrigger `
    -Principal $principal `
    -Settings $settings `
    -Force | Out-Null

$weeklyTrigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At '3:00 AM'
Register-ScheduledTask `
    -TaskName 'LibraryFlow Database Backup - Weekly' `
    -Description 'Creates a weekly MySQL backup for the LibraryFlow database.' `
    -Action $action `
    -Trigger $weeklyTrigger `
    -Principal $principal `
    -Settings $settings `
    -Force | Out-Null

Write-Output 'Installed daily (2:00 AM) and weekly (Sunday, 3:00 AM) database backup tasks.'
