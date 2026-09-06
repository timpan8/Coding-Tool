import { dialog } from './make-dialog.mjs';

/** v4 — fyra platshållare finns redan sedan tidigare versioner. */
export const baseTemplate = `$Domain      = "{{DOMAIN}}"
$AdminUser   = "{{ADMIN_USER}}"
$Users       = Get-Content "{{USERS_PATH}}"
$ExportPath  = "{{EXPORT_PATH}}"

$Result = foreach ($User in $Users) {
    try {
        $ADUser = Get-ADUser -Identity $User -Server $Domain -Credential $AdminUser \`
            -Properties DisplayName, Mail, Title, Department, City, StreetAddress, PostalCode
        [PSCustomObject]@{
            SamAccountName = $ADUser.SamAccountName
            DisplayName    = $ADUser.DisplayName
            Mail           = $ADUser.Mail
            Title          = $ADUser.Title
            Department     = $ADUser.Department
            City           = $ADUser.City
        }
    }
    catch {
        Write-Warning "Hittade inte $User"
    }
}

$Result | Export-Csv $ExportPath -NoTypeInformation -Encoding UTF8`;

/** Det AI:n gav tillbaka: exempelvärdena insatta igen, plus egna ändringar. */
export const pasted = baseTemplate
  .replace('{{DOMAIN}}', 'corp.example.com')
  .replace('{{ADMIN_USER}}', 'svc-adexport')
  .replace('{{USERS_PATH}}', 'C:\\Temp\\Example')
  .replace('{{EXPORT_PATH}}', 'C:\\Export\\users.csv')
  .replace('$ExportPath  = "C:\\Export\\users.csv"', '$ExportPath  = "C:\\Export\\users.csv"\n$PageSize    = 500')
  .replace('            City           = $ADUser.City\n', '            City           = $ADUser.City\n            PostalCode     = $ADUser.PostalCode\n')
  .replace('Write-Warning "Hittade inte $User"', 'Write-Warning "Hittade inte $User i $Domain"')
  .replace('-Encoding UTF8', "-Encoding UTF8 -Delimiter ';'");

/** Mallen efter att de accepterade mappningarna lagts tillbaka. */
export const mappedTemplate = pasted
  .replace('corp.example.com', '{{DOMAIN}}')
  .replace('svc-adexport', '{{ADMIN_USER}}')
  .replace('C:\\Temp\\Example', '{{USERS_PATH}}')
  .replace('C:\\Export\\users.csv', '{{EXPORT_PATH}}');

export const mappings = [
  { name: 'DOMAIN', value: 'corp.example.com', line: 1, column: 16, occurrences: 1, method: 'ai-value', confidence: 'hög', accepted: true, selected: true },
  { name: 'ADMIN_USER', value: 'svc-adexport', line: 2, column: 16, occurrences: 1, method: 'ai-value', confidence: 'hög', accepted: true },
  { name: 'USERS_PATH', value: 'C:\\Temp\\Example', line: 3, column: 30, occurrences: 1, method: 'ai-value', confidence: 'hög', accepted: true },
  { name: 'EXPORT_PATH', value: 'C:\\Export\\users.csv', line: 4, column: 16, occurrences: 1, method: 'likhet', confidence: 'medel', accepted: true },
  { name: 'PAGE_SIZE', value: '500', line: 5, column: 16, occurrences: 1, method: 'namn', confidence: 'låg', accepted: false },
];

export const html = dialog({ baseNumber: 4, baseTemplate, pasted, mappedTemplate, mappings, unresolved: 1, conflicts: 1 });
