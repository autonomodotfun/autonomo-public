# Creates tables and loads data into a Neon database. Prompts for the connection string so it never lands in a file.
$secure = Read-Host -AsSecureString "Paste the Neon connection string (postgresql://...)"
$env:DATABASE_URL = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
  [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
if (-not $env:DATABASE_URL.StartsWith("postgres")) { Write-Error "That doesn't look like a postgres:// URL."; exit 1 }
try {
  npm run db:setup
} finally {
  Remove-Item Env:DATABASE_URL
}
