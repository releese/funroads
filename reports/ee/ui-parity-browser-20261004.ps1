# Local acceptance probe. Uses only the existing desktop-owned QA pane.
$ErrorActionPreference = 'Stop'
$root = 'C:\Users\risto\funroads'
function Ab {
    $output = & agent-browser --cdp $env:AGENT_BROWSER_CDP --json @args
    if ($LASTEXITCODE -ne 0) { throw ($output -join "`n") }
    $response = ($output -join "`n") | ConvertFrom-Json
    if (!$response.success) { throw $response.error }
    return $response.data
}
function EvalJs([string]$code) {
    return (Ab eval -b ([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($code)))).result
}
function Require([bool]$condition, [string]$message) {
    if (!$condition) { throw $message }
}
$checks = [Collections.Generic.List[object]]::new()
$fingerprint = @'
(async () => { const bytes=new TextEncoder().encode(localStorage.getItem('funroads:favorites:v1')||''); const hash=await crypto.subtle.digest('SHA-256',bytes); return Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join(''); })()
'@
$before = EvalJs $fingerprint
$measure = @'
(() => {
  const box=e=>{const r=e.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}};
  const detail=document.querySelector('.fr-detail'),body=document.querySelector('.fr-detail-content');
  const link=detail.querySelector('a[aria-label="Open in Google Maps"]'),url=new URL(link.href);
  const bounds=box(detail),target=box(link);
  return {viewport:[innerWidth,innerHeight],bounds,target,bodyFits:body.scrollWidth<=body.clientWidth+1,
    detailFits:bounds.left>=0&&bounds.top>=0&&bounds.right<=innerWidth&&bounds.bottom<=innerHeight,
    navigateVisible:target.top>=0&&target.bottom<=innerHeight&&target.height>=44,
    waypoints:(url.searchParams.get('waypoints')||'').split('|').filter(Boolean).length,
    route:new URLSearchParams(location.hash.slice(1)).get('route'),targetBlank:link.target==='_blank'};
})()
'@
try {
    foreach ($size in @(@(1789,1288), @(1024,768), @(390,844))) {
        Ab set viewport $size[0] $size[1] | Out-Null
        foreach ($country in @('nl','ee')) {
            $base = if ($country -eq 'ee') { "$root\data\ee\cache" } else { "$root\data\cache" }
            $routes = Get-Content -LiteralPath "$base\routes.json" -Raw | ConvertFrom-Json
            $linked = Get-Content -LiteralPath "$base\linked.json" -Raw | ConvertFrom-Json
            $examples = @(
                @{family='circuit'; route=($routes.routes | Sort-Object {$_.name.Length} -Descending | Select-Object -First 1)},
                @{family='sprint'; route=($routes.sprints | Sort-Object {$_.name.Length} -Descending | Select-Object -First 1)},
                @{family='linked'; route=($linked.rides | Where-Object type -ne 'circuit' | Sort-Object {$_.name.Length} -Descending | Select-Object -First 1)},
                @{family='linked'; route=($linked.rides | Where-Object type -eq 'circuit' | Sort-Object {$_.name.Length} -Descending | Select-Object -First 1)}
            )
            foreach ($example in $examples) {
                $prefix = if ($country -eq 'ee') { 'ee:' } else { '' }
                $key = "${prefix}$($example.family):$($example.route.id)"
                $url = "http://127.0.0.1:5174/?country=$country&qa=ui-parity-aligned-20261004#route=$([Uri]::EscapeDataString($key))&detail=1"
                Ab open $url | Out-Null
                Ab wait '.fr-detail-navigation a' | Out-Null
                $result = EvalJs $measure
                Require ($result.detailFits -and $result.bodyFits -and $result.navigateVisible -and $result.targetBlank) "Detail layout failed: $country $key $size"
                Require ($result.waypoints -le $(if ($size[0] -lt 768) {3} else {9})) 'Waypoint budget failed'
                Require ($result.route -eq $key) 'Wrong selected route'
                Ab find role button click --name 'Close details' --exact | Out-Null
                $retained = EvalJs "new URLSearchParams(location.hash.slice(1)).get('route')"
                Require ($retained -eq $key) 'Closing details lost selection'
                $checks.Add(@{country=$country;family=$example.family;type=$example.route.type;id=$example.route.id;result=$result;selectionRetained=$true})
                Write-Host "Passed $country $($example.family) $($example.route.id) $($size -join 'x')"
            }
        }
    }
    foreach ($country in @('nl','ee')) {
        Ab set viewport 320 740 | Out-Null
        $name = if ($country -eq 'ee') { 'Estonia' } else { 'Netherlands' }
        Ab open "http://127.0.0.1:5174/?country=$country&qa=ui-parity-aligned-20261004" | Out-Null
        Ab wait 'header button' | Out-Null
        Ab find role button click --name "Change country: $name" --exact | Out-Null
        Ab wait 'nav[aria-label="Choose country"]' | Out-Null
        $menu = EvalJs @'
(() => { const p=document.querySelector('header button'),h=document.querySelector('h1'),n=document.querySelector('nav');const r=n.getBoundingClientRect(),a=p.querySelector('span').getBoundingClientRect(),b=h.getBoundingClientRect();return {fits:r.left>=0&&r.right<=innerWidth,height:p.getBoundingClientRect().height,stacked:a.top>=b.bottom,leftAligned:Math.abs(a.left-b.left)<1,smaller:parseFloat(getComputedStyle(p).fontSize)<parseFloat(getComputedStyle(h).fontSize)}; })()
'@
        Require ($menu.fits -and $menu.height -ge 44 -and $menu.stacked -and $menu.leftAligned -and $menu.smaller) 'Narrow country picker failed'
        Ab press Escape | Out-Null
        $focused = EvalJs 'document.activeElement.getAttribute("aria-label")'
        Require ($focused -eq "Change country: $name") 'Country picker focus did not return'
        Ab hover '.fr-country-button' | Out-Null
        $hover = EvalJs @'
(() => { const p=document.querySelector('.fr-country-button'),s=p.querySelector('span'),h=document.querySelector('h1');return {noOverlap:s.getBoundingClientRect().top>=h.getBoundingClientRect().bottom,compactLabel:s.getBoundingClientRect().height<44,transparentTarget:getComputedStyle(p).backgroundColor==='rgba(0, 0, 0, 0)',transparentLabel:getComputedStyle(s).backgroundColor==='rgba(0, 0, 0, 0)',underline:getComputedStyle(s).textDecorationLine.includes('underline'),noButtonShadow:getComputedStyle(p).boxShadow==='none'}; })()
'@
        Require ($hover.noOverlap -and $hover.compactLabel -and $hover.transparentTarget -and $hover.transparentLabel -and $hover.underline -and $hover.noButtonShadow) 'Country underline hover failed'
        $checks.Add(@{country=$country;viewport=@(320,740);menu=$menu;focusReturned=$true;hover=$hover})
    }
    Ab find role button click --name 'Change country: Estonia' --exact | Out-Null
    Ab find role link click --name 'Netherlands' --exact | Out-Null
    Ab wait '[aria-label="Change country: Netherlands"]' | Out-Null
    $switched = EvalJs '({country:new URL(location.href).searchParams.get("country"),hash:location.hash})'
    Require ($switched.country -eq 'nl' -and $switched.hash -eq '') 'Native switch did not clear country context'
    Ab back | Out-Null
    Ab wait '[aria-label="Change country: Estonia"]' | Out-Null
    Require ((EvalJs 'new URL(location.href).searchParams.get("country")') -eq 'ee') 'Browser Back failed'
    Require ((EvalJs $fingerprint) -eq $before) 'Favorites changed during acceptance'
    $checks.Add(@{nativeSwitch=$true;browserBack=$true;favoritesUntouched=$true})
} finally {
    $checks | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath "$root\reports\ee\ui-parity-browser-20261004.json"
    Ab set viewport 1789 1288 | Out-Null
}
