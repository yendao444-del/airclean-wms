param(
    [Parameter(Mandatory = $true)][string]$PromptPath,
    [Parameter(Mandatory = $true)][string]$OutputPath,
    [Parameter(Mandatory = $true)][string]$ReferencePath,
    [string]$ReferencePath2 = ''
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Net.Http
$referenceBytes = [System.IO.File]::ReadAllBytes($ReferencePath)
$referenceData = "data:image/png;base64,$([Convert]::ToBase64String($referenceBytes))"
$payloadData = @{
    model = 'cx/gpt-5.5-image'
    prompt = [System.IO.File]::ReadAllText($PromptPath)
    size = '1536x1024'
    quality = 'high'
    output_format = 'png'
    image_detail = 'high'
    image = $referenceData
}
if ($ReferencePath2 -and [System.IO.File]::Exists($ReferencePath2)) {
    $referenceBytes2 = [System.IO.File]::ReadAllBytes($ReferencePath2)
    $referenceData2 = "data:image/png;base64,$([Convert]::ToBase64String($referenceBytes2))"
    $payloadData.Remove('image')
    $payloadData.images = @($referenceData, $referenceData2)
}
$payload = $payloadData | ConvertTo-Json -Compress -Depth 6

try {
    $client = New-Object System.Net.Http.HttpClient
    $client.Timeout = [TimeSpan]::FromMinutes(5)
    if ($env:NINEROUTER_KEY) { $client.DefaultRequestHeaders.Authorization = New-Object System.Net.Http.Headers.AuthenticationHeaderValue('Bearer', $env:NINEROUTER_KEY) }
    $content = New-Object System.Net.Http.StringContent($payload, [System.Text.Encoding]::UTF8, 'application/json')
    $response = $client.PostAsync("$env:NINEROUTER_URL/v1/images/generations?response_format=binary", $content).GetAwaiter().GetResult()
    if (-not $response.IsSuccessStatusCode) {
        $responseText = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
        throw "HTTP $([int]$response.StatusCode): $responseText"
    }
    $bytes = $response.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult()
    [System.IO.File]::WriteAllBytes($OutputPath, $bytes)
    Set-Content -LiteralPath "$OutputPath.done" -Value 'ok'
} catch {
    $detail = $_ | Out-String
    Set-Content -LiteralPath "$OutputPath.error" -Value $detail
    exit 1
}
