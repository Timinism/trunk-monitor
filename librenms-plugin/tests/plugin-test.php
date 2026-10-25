<?php

declare(strict_types=1);

use App\Plugins\RibbonTrunks\Support\Config;
use App\Plugins\RibbonTrunks\Support\FileSnapshot;
use App\Plugins\RibbonTrunks\Support\MailText;
use App\Plugins\RibbonTrunks\Support\Poller;
use App\Plugins\RibbonTrunks\Support\Status;
use App\Plugins\RibbonTrunks\Support\Url;
use App\Plugins\RibbonTrunks\Support\Xml;

spl_autoload_register(static function (string $class): void {
    $prefix = 'App\\Plugins\\RibbonTrunks\\';
    if (! str_starts_with($class, $prefix)) {
        return;
    }
    $path = dirname(__DIR__).'/RibbonTrunks/'.str_replace('\\', '/', substr($class, strlen($prefix))).'.php';
    if (is_file($path)) {
        require $path;
    }
});

$failures = 0;

function check(bool $ok, string $message): void
{
    global $failures;
    if ($ok) {
        return;
    }
    $failures++;
    fwrite(STDERR, "FAIL {$message}\n");
}

function same(mixed $actual, mixed $expected, string $message): void
{
    if ($actual !== $expected) {
        check(false, $message."\n  expected ".var_export($expected, true)."\n  actual   ".var_export($actual, true));

        return;
    }
    check(true, $message);
}

const DETAILS = <<<'XML'
<?xml version="1.0"?>
<root>
  <status><http_code>200</http_code></status>
  <sipsg id="1" href="https://sbc.example/rest/sipsg/1">
    <Description>PSTN Primary</Description>
    <customAdminState>1</customAdminState>
    <Channels>24</Channels>
    <ServerClusterId>3</ServerClusterId>
    <ListenPort_1>5060</ListenPort_1>
    <Protocol_1>1</Protocol_1>
    <InteropMode>0</InteropMode>
    <rt_Status>0</rt_Status>
    <rt_NumberOfChannels>24</rt_NumberOfChannels>
    <rt_NumCurrentCalls>4</rt_NumCurrentCalls>
    <rt_NumIngressCurrentCalls>3</rt_NumIngressCurrentCalls>
    <rt_NumEgressCurrentCalls>1</rt_NumEgressCurrentCalls>
    <rt_NumConnectedCalls>4</rt_NumConnectedCalls>
    <rt_NumTotalCalls>900</rt_NumTotalCalls>
    <rt_NumRefusedCalls>2</rt_NumRefusedCalls>
    <rt_NumBlockedCalls>1</rt_NumBlockedCalls>
    <rt_NumErroredCalls>0</rt_NumErroredCalls>
    <rt_NumIngressCallAttempts>500</rt_NumIngressCallAttempts>
    <rt_NumIngressCallsAccepted>480</rt_NumIngressCallsAccepted>
    <rt_NumIngressCallsCompleted>470</rt_NumIngressCallsCompleted>
    <rt_NumIngressCallsRejected>8</rt_NumIngressCallsRejected>
    <rt_NumIngressCallsBlocked>1</rt_NumIngressCallsBlocked>
    <rt_NumEgressCallAttempts>400</rt_NumEgressCallAttempts>
    <rt_NumEgressCallsAccepted>390</rt_NumEgressCallsAccepted>
    <rt_NumEgressCallsCompleted>388</rt_NumEgressCallsCompleted>
    <rt_NumEgressCallsRejected>3</rt_NumEgressCallsRejected>
    <rt_NumEgressCallsBlocked>0</rt_NumEgressCallsBlocked>
  </sipsg>
  <sipsg id="4" href="https://sbc.example/rest/sipsg/4">
    <Description>Fax</Description>
    <customAdminState>0</customAdminState>
    <rt_Status>1</rt_Status>
    <Channels>4</Channels>
    <ServerClusterId>0</ServerClusterId>
  </sipsg>
</root>
XML;

$groups = Xml::signalingGroups(DETAILS);
same(count($groups), 2, 'two signaling groups');
same($groups[0]['name'], 'PSTN Primary', 'primary name');
same($groups[0]['health'], 'up', 'primary health');
same($groups[0]['statusLabel'], 'Up', 'primary label');
same($groups[0]['channels'], 24, 'channels');
same($groups[0]['currentCalls'], 4, 'current calls');
same($groups[0]['calls']['ingressCurrent'], 3, 'ingress current');
same($groups[0]['calls']['egressCurrent'], 1, 'egress current');
same($groups[0]['calls']['connected'], 4, 'connected');
same($groups[0]['calls']['total'], 900, 'total');
same($groups[0]['calls']['refused'], 2, 'refused');
same($groups[0]['calls']['ingressAttempts'], 500, 'ingress attempts');
same($groups[0]['calls']['egressBlocked'], 0, 'egress blocked');
same($groups[1]['calls']['total'], null, 'missing total stays null');
same($groups[0]['protocol'], 'UDP 5060', 'listener');
same($groups[0]['interop'], 'Standard', 'interop');
same($groups[0]['serverClusterId'], '3', 'cluster');
same($groups[0]['stub'], false, 'detailed row is not a stub');
same($groups[1]['health'], 'disabled', 'admin disabled is not an alarm');
same($groups[1]['statusLabel'], 'Disabled', 'disabled label');
same($groups[1]['serverClusterId'], '', 'zero cluster is empty');

$peersDown = Xml::signalingGroups(<<<'XML'
<?xml version="1.0"?>
<root>
  <status><http_code>200</http_code></status>
  <resource>
    <sipsg id="9">
      <Description>Teams</Description>
      <customAdminState>cmCustomEnabled</customAdminState>
      <rt_Status>sgsUpPeersDown</rt_Status>
    </sipsg>
  </resource>
</root>
XML);
same($peersDown[0]['health'], 'down', 'peers down is down');
same($peersDown[0]['statusLabel'], 'Peers down', 'peers down label');
same($peersDown[0]['rawStatus'], 'sgsUpPeersDown', 'symbolic status');

$stubs = Xml::signalingGroups(<<<'XML'
<?xml version="1.0"?>
<root>
  <status><http_code>200</http_code></status>
  <sipsg_list>
    <sipsg id="7" href="https://sbc.example/rest/sipsg/7"/>
    <sipsg href="https://sbc.example/rest/sipsg/8"/>
  </sipsg_list>
</root>
XML);
same([$stubs[0]['id'], $stubs[0]['stub'], $stubs[1]['id'], $stubs[1]['stub']], ['7', true, '8', true], 'href stubs keep their ids');

$system = Xml::system(<<<'XML'
<?xml version="1.0"?>
<root><status><http_code>200</http_code></status>
<system>
  <NodeName>edge-01</NodeName>
  <rt_Software_Base_Version>12.3.1</rt_Software_Base_Version>
  <rt_Software_Base_BuildNumber>550</rt_Software_Base_BuildNumber>
</system></root>
XML);
same($system, ['name' => 'edge-01', 'version' => '12.3.1 build 550'], 'system identity');
same(Xml::sipServers(<<<'XML'
<?xml version="1.0"?>
<root><sipserver id="1"><Host>sip.carrier.example</Host><Port>5060</Port></sipserver></root>
XML), ['sip.carrier.example:5060'], 'sip server');

$status = Xml::apiStatus(<<<'XML'
<?xml version="1.0"?>
<root><status><http_code>400</http_code>
<app_status href="/rest/sipsg"><app_status_entry code="20035" params=""/></app_status></status></root>
XML);
same($status, ['httpCode' => 400, 'appCode' => '20035'], 'application error code');

$draining = Status::classifyHealth(Status::normalizeStatus('sgsUpDraining'), 'enabled');
same($draining, 'degraded', 'draining is degraded');
same(Status::isAlarming('down', false), true, 'down alarms');
same(Status::isAlarming('degraded', false), false, 'draining is quiet unless asked');
same(Status::isAlarming('degraded', true), true, 'draining can alarm');
same(Status::isAlarming('disabled', false), false, 'disabled does not alarm');

$now = new DateTimeImmutable('2026-10-25T15:00:00+00:00');
$options = [
    'alertOnDegraded' => false,
    'alertOnStartup' => false,
    'alertOnRecovery' => true,
    'reminderMinutes' => 0,
    'now' => $now,
];
$observation = static function (string $id, string $health, string $name = 'Lumen'): array {
    return [
        'id' => $id,
        'sgId' => '3',
        'name' => $name,
        'health' => $health,
        'rawStatus' => $health === 'down' ? 'sgsDOWN' : 'sgsUP',
        'statusLabel' => $health,
        'adminState' => 'enabled',
    ];
};
$first = Status::evaluateAlarms([], [$observation('edge-a:3', 'down')], $options);
same($first[0]['transition'], null, 'first look does not email when startup alerts are off');
same($first[0]['alarming'], true, 'first look still remembers the down state');
check(is_string($first[0]['downSince']) && $first[0]['downSince'] !== '', 'down since is set');

$up = Status::evaluateAlarms([], [$observation('1', 'up')], $options);
$down = Status::evaluateAlarms($up, [$observation('1', 'down')], $options);
same($down[0]['transition']['kind'] ?? null, 'down', 'up to down emails');
$still = Status::evaluateAlarms($down, [$observation('1', 'down')], $options);
same($still[0]['transition'], null, 'staying down does not email again');
$recovered = Status::evaluateAlarms($down, [$observation('1', 'up')], [
    ...$options,
    'now' => new DateTimeImmutable('2026-10-25T16:00:00+00:00'),
]);
same($recovered[0]['transition']['kind'] ?? null, 'recovery', 'recovery emails');
same($recovered[0]['alarming'], false, 'recovery clears the alarm');
same($recovered[0]['downSince'], null, 'recovery clears down since');

same(Status::matchesWatchFilter(['id' => 'edge-a:3', 'sgId' => '3', 'name' => 'Lumen'], ''), true, 'empty filter matches');
same(Status::matchesWatchFilter(['id' => 'edge-a:3', 'sgId' => '3', 'name' => 'Lumen'], '3'), true, 'filter matches signaling group id');
same(Status::matchesWatchFilter(['id' => 'edge-a:3', 'sgId' => '3', 'name' => 'Lumen'], 'edge-a:3'), true, 'filter matches composite id');
same(Status::matchesWatchFilter(['id' => 'edge-a:3', 'sgId' => '3', 'name' => 'Lumen'], 'fax'), false, 'filter misses other names');

same(Url::restBase('192.0.2.10', 443), 'https://192.0.2.10/rest', 'default https port is omitted');
same(Url::restBase('sbc.example.com', 8443), 'https://sbc.example.com:8443/rest', 'custom port is kept');
same(Url::restBase('sbc.example.com:8443', 443), 'https://sbc.example.com:8443/rest', 'explicit port wins');
same(Url::restBase('https://sbc.example.com/rest', 443), 'https://sbc.example.com/rest', 'existing rest path');
same(Url::restBase('[2001:db8::10]', 443), 'https://[2001:db8::10]/rest', 'ipv6 host');
$threw = false;
try {
    Url::restBase('   ', 443);
} catch (Throwable) {
    $threw = true;
}
check($threw, 'empty address is rejected');

$normalized = Config::normalize([
    'sbcs' => [
        ['id' => 'edge-a', 'name' => 'Chicago', 'host' => 'sbc-a.example.com', 'port' => '8443', 'username' => 'rest', 'password' => 'secret', 'tlsVerify' => '0', 'enabled' => '1'],
        ['id' => 'edge-b', 'name' => '', 'host' => '', 'username' => '', 'password' => ''],
        ['id' => 'bad id', 'name' => 'Dallas', 'host' => 'sbc-b.example.com', 'port' => '0', 'username' => 'rest', 'password' => 'secret', 'enabled' => '0'],
    ],
    'pollIntervalSeconds' => '10',
    'unreachableThreshold' => '99',
    'alertOnRecovery' => '0',
]);
same(count($normalized['sbcs']), 2, 'empty SBC cards are dropped');
same($normalized['sbcs'][0]['port'], 8443, 'string port is kept');
same($normalized['sbcs'][0]['password'], 'secret', 'password round-trips');
same($normalized['sbcs'][1]['port'], 443, 'invalid port falls back to 443');
same($normalized['sbcs'][1]['enabled'], false, 'disabled checkbox is false');
$stable = ['sbcs' => [['id' => 'bad id', 'name' => 'Dallas', 'host' => 'sbc-b.example.com', 'username' => 'rest', 'password' => 'secret']]];
$firstId = Config::normalize($stable)['sbcs'][0]['id'];
$secondId = Config::normalize($stable)['sbcs'][0]['id'];
same($firstId === 'bad id', false, 'invalid id is replaced');
same($firstId, $secondId, 'replacement id is stable');
same($normalized['pollIntervalSeconds'], 15, 'interval is clamped');
same($normalized['unreachableThreshold'], 20, 'threshold is clamped');
same($normalized['alertOnRecovery'], false, 'recovery can be turned off');
same($normalized['alertOnDegraded'], false, 'degraded defaults off');
$many = [];
for ($i = 0; $i < 21; $i++) {
    $many[] = ['id' => 's'.$i, 'name' => 'S'.$i, 'host' => 'h'.$i.'.example', 'username' => 'u', 'password' => 'p'];
}
same(count(Config::normalize(['sbcs' => $many])['sbcs']), 20, 'SBC list stops at 20');

$mail = MailText::trunk([
    'kind' => 'down',
    'trunk' => $observation('edge-a:3', 'down', 'PSTN Primary') + [
        'sbcName' => 'edge-01',
        'sbcHost' => 'sbc.example.com',
        'adminState' => 'enabled',
        'channels' => 24,
        'currentCalls' => 4,
        'calls' => Xml::emptyCalls(),
        'peers' => [],
        'protocol' => 'UDP 5060',
        'interop' => 'Standard',
        'statusLabel' => 'Down',
        'rawStatus' => 'sgsDOWN',
    ],
    'previousHealth' => 'up',
    'sbcName' => 'edge-01',
    'sbcHost' => 'sbc.example.com',
    'downSince' => '2026-10-25T15:00:00+00:00',
    'now' => $now,
]);
check(str_contains($mail['subject'], 'PSTN Primary'), 'mail subject names the trunk');
check(str_contains($mail['subject'], 'DOWN'), 'mail subject says down');
check(! str_contains($mail['text'], 'secret'), 'mail body has no password');

$client = file_get_contents(dirname(__DIR__).'/RibbonTrunks/Support/RibbonClient.php');
same(substr_count((string) $client, "'POST'"), 1, 'login is the only POST');
check($client !== false && ! str_contains($client, 'PUT') && ! str_contains($client, 'DELETE'), 'client has no write methods');

$hooks = array_map('basename', glob(dirname(__DIR__).'/RibbonTrunks/*.php') ?: []);
sort($hooks);
same($hooks, ['Menu.php', 'Page.php', 'Settings.php'], 'only hook classes sit in the plugin root');
check(is_file(dirname(__DIR__).'/RibbonTrunks/bin/poll.php'), 'poller is outside the hook directory');
$pollerSource = (string) file_get_contents(dirname(__DIR__).'/RibbonTrunks/bin/poll.php');
check(str_contains($pollerSource, 'dirname(__DIR__, 4)'), 'poller walks up to the LibreNMS root');
check(str_contains((string) file_get_contents(dirname(__DIR__).'/RibbonTrunks/resources/views/page.blade.php'), '<details'), 'trunk rows use disclosure widgets');
check(str_contains((string) file_get_contents(dirname(__DIR__).'/RibbonTrunks/resources/views/settings.blade.php'), 'settings[sbcs]'), 'settings form posts the SBC list');
check(str_starts_with(trim((string) file_get_contents(dirname(__DIR__).'/RibbonTrunks/resources/views/menu.blade.php')), '<a '), 'menu entry is only a link');

function sbc(array $over = []): array
{
    return array_merge([
        'id' => 'a',
        'name' => 'Chicago',
        'host' => 'sbc-a.example.com',
        'port' => 443,
        'username' => 'rest',
        'password' => 'secret-password',
        'tlsVerify' => false,
        'enabled' => true,
    ], $over);
}

function observed(array $over = []): array
{
    return array_merge([
        'id' => 'a:1',
        'sbcId' => 'a',
        'sbcName' => 'edge-a',
        'sbcHost' => 'sbc-a.example.com',
        'sgId' => '1',
        'name' => 'PSTN',
        'health' => 'up',
        'rawStatus' => 'sgsUP',
        'statusLabel' => 'Up',
        'adminState' => 'enabled',
        'channels' => 24,
        'currentCalls' => 1,
        'calls' => Xml::emptyCalls(),
        'peers' => ['sip.example:5060'],
        'interop' => 'Standard',
        'protocol' => 'UDP 5060',
    ], $over);
}

function runPoll(string $path, DateTimeImmutable $now, array $settings, Closure $source, array &$mails, bool $force = true): array
{
    $poller = new Poller(
        new FileSnapshot($path),
        $source,
        static function (string $recipients, string $kind, string $subject, string $text, ?string $host) use (&$mails): array {
            $mails[] = compact('recipients', 'kind', 'subject', 'text', 'host');

            return ['status' => 'sent', 'detail' => ''];
        },
        $now,
    );
    $poller->poll($settings, $force);

    return (new FileSnapshot($path))->read();
}

$dir = sys_get_temp_dir().'/ribbon-trunks-'.bin2hex(random_bytes(4));
mkdir($dir);
$path = $dir.'/ribbon-trunks.json';
$mails = [];
$phase = 'down';
$settings = [
    'sbcs' => [sbc()],
    'alertRecipients' => 'noc@example.com',
    'alertOnStartup' => false,
    'alertOnRecovery' => true,
    'unreachableThreshold' => 2,
    'pollIntervalSeconds' => 60,
];
$source = static function (array $sbc) use (&$phase): array {
    if ($phase === 'throw') {
        throw new RuntimeException('connection refused');
    }
    $health = $phase === 'down' ? 'down' : 'up';

    return [
        'name' => 'edge-a',
        'version' => '12.3.1',
        'host' => $sbc['host'],
        'trunks' => [observed(['health' => $health, 'statusLabel' => $health === 'down' ? 'Down' : 'Up', 'rawStatus' => $health === 'down' ? 'sgsDOWN' : 'sgsUP'])],
    ];
};

$snapshot = runPoll($path, $now, $settings, $source, $mails);
same(count($mails), 0, 'startup down does not email');
same($snapshot['trunks'][0]['alarming'], true, 'startup down is stored as alarming');
check(! str_contains((string) file_get_contents($path), 'secret-password'), 'snapshot does not store the password');

$snapshot = runPoll($path, $now->modify('+1 minute'), $settings, $source, $mails);
same(count($mails), 0, 'staying down does not email again');

$phase = 'up';
$snapshot = runPoll($path, $now->modify('+2 minutes'), $settings, $source, $mails);
same($mails[0]['kind'] ?? null, 'recovery', 'recovery is delivered');
same($snapshot['trunks'][0]['health'], 'up', 'recovered trunk is up');

$phase = 'down';
runPoll($path, $now->modify('+3 minutes'), $settings, $source, $mails);
same($mails[1]['kind'] ?? null, 'down', 'a later down transition emails');
check(str_contains($mails[1]['subject'], 'PSTN'), 'down mail names the trunk');

$kept = FileSnapshot::blank();
$kept['trunks'] = [observed(['id' => 'b:1', 'sbcId' => 'b', 'name' => 'Keep me', 'health' => 'up'])];
(new FileSnapshot($path))->write($kept);
$partialMails = [];
$partial = runPoll($path, $now, [
    'sbcs' => [
        sbc(),
        sbc(['id' => 'b', 'name' => 'Dallas', 'host' => 'sbc-b.example.com', 'password' => 'other-secret']),
        sbc(['id' => 'c', 'name' => 'Spare', 'host' => 'sbc-c.example.com', 'username' => '', 'password' => '']),
    ],
    'alertRecipients' => 'noc@example.com',
    'alertOnStartup' => false,
], static function (array $sbc): array {
    if ($sbc['id'] === 'b') {
        throw new RuntimeException('connection refused');
    }

    return [
        'name' => 'edge-a',
        'version' => '12.3.1',
        'host' => $sbc['host'],
        'trunks' => [observed()],
    ];
}, $partialMails);
$names = array_map(static fn (array $trunk): string => (string) $trunk['name'], $partial['trunks']);
sort($names);
same($names, ['Keep me', 'PSTN'], 'a failed SBC keeps its previous trunks');
$keptTrunk = null;
foreach ($partial['trunks'] as $trunk) {
    if (($trunk['sbcId'] ?? '') === 'b') {
        $keptTrunk = $trunk;
    }
}
same($keptTrunk['name'] ?? null, 'Keep me', 'the failed SBC keeps its own trunk');
same($keptTrunk['health'] ?? null, 'up', 'a failed poll does not mark the trunk down');
same($partial['runtimes']['b']['consecutiveFailures'], 1, 'failed SBC counts a failure');
same($partial['runtimes']['a']['consecutiveFailures'], 0, 'healthy SBC clears failures');
check(str_contains((string) $partial['lastError'], 'Dallas: connection refused'), 'multi-SBC errors are labeled');
check(str_contains((string) $partial['lastError'], 'Spare needs an address'), 'incomplete SBCs are noted');
check(! str_contains((string) file_get_contents($path), 'other-secret'), 'second password stays out of the snapshot');

$singlePath = $dir.'/single.json';
$singleMails = [];
$single = runPoll($singlePath, $now, [
    'sbcs' => [sbc()],
    'unreachableThreshold' => 3,
], static function (): array {
    throw new RuntimeException('connection refused');
}, $singleMails);
same($single['lastError'], 'connection refused', 'a single SBC error is not prefixed');
same(count($singleMails), 0, 'threshold holds the unreachable mail');

$again = runPoll($singlePath, $now->modify('+1 minute'), [
    'sbcs' => [sbc()],
    'unreachableThreshold' => 1,
    'alertRecipients' => 'noc@example.com',
], static function (): array {
    throw new RuntimeException('connection refused');
}, $singleMails);
same($singleMails[0]['kind'] ?? null, 'unreachable', 'threshold sends an unreachable mail');
same($again['trunks'], [], 'unreachable poll does not invent trunks');

$prior = FileSnapshot::blank();
$prior['trunks'] = [observed(['name' => 'Still here'])];
$prior['runtimes'] = ['a' => ['consecutiveFailures' => 2, 'unreachableAlertedAt' => '2026-10-25T14:00:00+00:00', 'lastError' => 'connection refused', 'nodeName' => 'edge-a', 'softwareVersion' => '', 'lastSuccessAt' => null]];
(new FileSnapshot($singlePath))->write($prior);
$backMails = [];
$back = runPoll($singlePath, $now, [
    'sbcs' => [sbc()],
    'alertRecipients' => 'noc@example.com',
    'alertOnStartup' => false,
], static function (array $sbc): array {
    return ['name' => 'edge-a', 'version' => '12', 'host' => $sbc['host'], 'trunks' => [observed()]];
}, $backMails);
same($backMails[0]['kind'] ?? null, 'reachable', 'a recovered SBC sends reachable');
same($back['runtimes']['a']['consecutiveFailures'], 0, 'success clears the failure count');
same($back['runtimes']['a']['unreachableAlertedAt'], null, 'success clears the unreachable flag');
same($back['trunks'][0]['name'], 'PSTN', 'success replaces trunks');

$both = FileSnapshot::blank();
$both['trunks'] = [observed(['name' => 'Untouched'])];
(new FileSnapshot($singlePath))->write($both);
$none = runPoll($singlePath, $now, [
    'sbcs' => [sbc(), sbc(['id' => 'b', 'name' => 'Dallas', 'host' => 'sbc-b.example.com'])],
    'unreachableThreshold' => 5,
], static function (): array {
    throw new RuntimeException('timed out');
}, $backMails);
same($none['trunks'][0]['name'], 'Untouched', 'total failure leaves trunks unchanged');

$skipped = 0;
$intervalPath = $dir.'/interval.json';
(new FileSnapshot($intervalPath))->write(array_merge(FileSnapshot::blank(), ['lastPollAt' => Status::stamp($now)]));
runPoll($intervalPath, $now->modify('+30 seconds'), ['sbcs' => [sbc()], 'pollIntervalSeconds' => 60], static function () use (&$skipped): array {
    $skipped++;
    throw new RuntimeException('should not poll');
}, $backMails, false);
same($skipped, 0, 'cron waits for the interval');

$empty = runPoll($dir.'/empty.json', $now, ['sbcs' => []], static function (): array {
    throw new RuntimeException('should not poll');
}, $backMails);
same($empty['lastError'], 'Add the SBC address and REST username in Settings.', 'no SBC explains what to add');
same($empty['consecutiveFailures'], 0, 'missing config is not a failure streak');

if ($failures > 0) {
    fwrite(STDERR, "{$failures} failed\n");
    exit(1);
}

echo "ok\n";
