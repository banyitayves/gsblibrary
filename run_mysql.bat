@echo off
setlocal
set "MYSQL_HOME=%ProgramFiles%\MySQL\MySQL Server 8.4"
set "MYSQL_DATA=%LOCALAPPDATA%\LibraryFlow\MySQL\data"

if not exist "%MYSQL_HOME%\bin\mysqld.exe" (
  echo MySQL Server 8.4 is not installed.
  echo Install it with: winget install --id Oracle.MySQL --exact
  exit /b 1
)

if not exist "%MYSQL_DATA%\auto.cnf" (
  echo MySQL has not been initialized. Run: npm.cmd run db:bootstrap
  exit /b 1
)

echo Starting local MySQL on 127.0.0.1:3306. Keep this window open.
"%MYSQL_HOME%\bin\mysqld.exe" --console --basedir="%MYSQL_HOME%" --datadir="%MYSQL_DATA%" --port=3306 --bind-address=127.0.0.1 --mysqlx=0 --log-error="%MYSQL_DATA%\mysql.log"
