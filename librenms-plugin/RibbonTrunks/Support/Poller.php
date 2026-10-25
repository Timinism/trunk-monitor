<?php

declare(strict_types=1);

namespace App\Plugins\RibbonTrunks\Support;

use DateTimeImmutable;
use DateTimeZone;

final class Poller
{
    /**
     * @param  callable(array<string, mixed>): array{name:string,version:string,host:string,trunks:list<array<string, mixed>>}  $source
     * @param  callable(string, string, string, string, ?string): array{status:string,detail:string}  $notify
     */
    public function __construct(
        private readonly FileSnapshot $snapshots,
        private readonly mixed $source,
        private readonly mixed $notify,
        private readonly DateTimeImmutable $now,
    ) {}

    public static function make(): self
    {
        return new self(
            new FileSnapshot(storage_path('app/ribbon-trunks.json')),
            static fn (array $sbc): array => (new RibbonSource)->collect($sbc),
            static fn (string $recipients, string $kind, string $subject, string $text, ?string $host): array => (new LibreNmsNotifier)->send($recipients, $kind, $subject, $text, $host),
            new DateTimeImmutable('now'),
        );
    }

    /**
     * @param  array<string, mixed>  $rawSettings
     */
    public function poll(array $rawSettings, bool $force = false): void
    {
        $settings = Config::normalize($rawSettings);
        $snapshot = $this->snapshots->read();
        if (! $force && ! $this->due($snapshot['lastPollAt'], $settings['pollIntervalSeconds'])) {
            return;
        }

        $targets = array_values(array_filter(
            $settings['sbcs'],
            static fn (array $sbc): bool => $sbc['enabled'] && Config::pollable($sbc),
        ));
        $notes = [];
        foreach ($settings['sbcs'] as $sbc) {
            if (! $sbc['enabled'] || Config::pollable($sbc)) {
                continue;
            }
            if (trim($sbc['host']) === '' && trim($sbc['username']) === '' && $sbc['password'] === '') {
                continue;
            }
            $notes[] = Config::label($sbc).' needs an address, REST username, and REST password before it can be polled.';
        }

        if ($targets === []) {
            $snapshot['lastPollAt'] = $this->stamp();
            $snapshot['lastError'] = $notes[0] ?? 'Add the SBC address and REST username in Settings.';
            $this->snapshots->write($snapshot);

            return;
        }

        $failed = [];
        $fresh = [];
        $anySuccess = false;
        $runtimes = $snapshot['runtimes'];

        foreach ($targets as $sbc) {
            $runtime = $this->runtime($runtimes[$sbc['id']] ?? null);
            try {
                $collected = ($this->source)($sbc);
                $watched = array_values(array_filter(
                    $collected['trunks'],
                    static fn (array $trunk): bool => Status::matchesWatchFilter($trunk, $settings['watchFilter']),
                ));
                foreach ($this->alarm($settings, $collected, $watched, $snapshot) as $trunk) {
                    $fresh[] = $trunk;
                }
                if ($runtime['unreachableAlertedAt'] !== null) {
                    $this->reachable(
                        $settings,
                        $snapshot,
                        (string) $collected['name'],
                        $sbc['host'],
                        (string) ($runtime['lastError'] ?? ''),
                        $runtime['consecutiveFailures'],
                    );
                }
                $runtimes[$sbc['id']] = [
                    'lastError' => null,
                    'consecutiveFailures' => 0,
                    'unreachableAlertedAt' => null,
                    'nodeName' => (string) $collected['name'],
                    'softwareVersion' => (string) $collected['version'],
                    'lastSuccessAt' => $this->stamp(),
                ];
                $anySuccess = true;
            } catch (\Throwable $error) {
                $message = $error->getMessage() !== '' ? $error->getMessage() : 'Poll failed.';
                $failures = $runtime['consecutiveFailures'] + 1;
                $detail = count($targets) === 1 ? $message : Config::label($sbc).': '.$message;
                $runtime['lastError'] = $detail;
                $runtime['consecutiveFailures'] = $failures;
                $already = $runtime['unreachableAlertedAt'] !== null;
                $shouldAlert = $failures >= $settings['unreachableThreshold'];
                $reminderDue = $shouldAlert
                    && $settings['reminderMinutes'] > 0
                    && $already
                    && Status::elapsed($this->now, (string) $runtime['unreachableAlertedAt']) !== null
                    && Status::elapsed($this->now, (string) $runtime['unreachableAlertedAt']) >= $settings['reminderMinutes'] * 60;
                if ($shouldAlert && (! $already || $reminderDue)) {
                    $kind = $already ? 'reminder' : 'unreachable';
                    $mail = MailText::reachability([
                        'kind' => $kind,
                        'sbcName' => $runtime['nodeName'] !== '' ? $runtime['nodeName'] : $sbc['name'],
                        'sbcHost' => $sbc['host'],
                        'detail' => $message,
                        'failures' => $failures,
                        'now' => $this->now,
                    ]);
                    $this->record(
                        $snapshot,
                        $kind,
                        null,
                        null,
                        $mail['subject'],
                        $mail['text'],
                        $this->deliver($settings['alertRecipients'], $kind, $mail, $sbc['host']),
                    );
                    $runtime['unreachableAlertedAt'] = $this->stamp();
                }
                $runtimes[$sbc['id']] = $runtime;
                $failed[$sbc['id']] = $detail;
            }
        }

        if ($anySuccess) {
            $kept = [];
            foreach ($snapshot['trunks'] as $trunk) {
                $sbcId = (string) ($trunk['sbcId'] ?? '');
                if (isset($failed[$sbcId])) {
                    $kept[] = $trunk;
                }
            }
            $snapshot['trunks'] = array_merge($fresh, $kept);
        }

        $keptRuntimes = [];
        foreach ($settings['sbcs'] as $sbc) {
            if (isset($runtimes[$sbc['id']])) {
                $keptRuntimes[$sbc['id']] = $runtimes[$sbc['id']];
            }
        }
        $snapshot['runtimes'] = $keptRuntimes;

        $failureCounts = [];
        $alertedAt = null;
        foreach ($targets as $sbc) {
            $runtime = $this->runtime($snapshot['runtimes'][$sbc['id']] ?? null);
            $failureCounts[] = $runtime['consecutiveFailures'];
            if ($alertedAt === null && $runtime['unreachableAlertedAt'] !== null) {
                $alertedAt = $runtime['unreachableAlertedAt'];
            }
        }
        $failureText = implode(' · ', array_values(array_filter(array_merge(array_values($failed), $notes))));
        $allClear = $anySuccess && $failed === [] && $notes === [];

        $snapshot['lastPollAt'] = $this->stamp();
        if ($anySuccess) {
            $snapshot['lastSuccessAt'] = $this->stamp();
        }
        $snapshot['lastError'] = $failureText !== '' ? $failureText : null;
        $snapshot['consecutiveFailures'] = $allClear ? 0 : ($failureCounts === [] ? 0 : max($failureCounts));
        $snapshot['events'] = array_slice($snapshot['events'], -40);
        $this->snapshots->write($snapshot);
    }

    /**
     * @param  array<string, mixed>|null  $runtime
     * @return array{lastError:?string,consecutiveFailures:int,unreachableAlertedAt:?string,nodeName:string,softwareVersion:string,lastSuccessAt:?string}
     */
    private function runtime(?array $runtime): array
    {
        return [
            'lastError' => is_string($runtime['lastError'] ?? null) ? $runtime['lastError'] : null,
            'consecutiveFailures' => is_numeric($runtime['consecutiveFailures'] ?? null) ? (int) $runtime['consecutiveFailures'] : 0,
            'unreachableAlertedAt' => is_string($runtime['unreachableAlertedAt'] ?? null) ? $runtime['unreachableAlertedAt'] : null,
            'nodeName' => is_string($runtime['nodeName'] ?? null) ? $runtime['nodeName'] : '',
            'softwareVersion' => is_string($runtime['softwareVersion'] ?? null) ? $runtime['softwareVersion'] : '',
            'lastSuccessAt' => is_string($runtime['lastSuccessAt'] ?? null) ? $runtime['lastSuccessAt'] : null,
        ];
    }

    /**
     * @param  array<string, mixed>  $settings
     * @param  array{name:string,version:string,host:string,trunks:list<array<string, mixed>>}  $collected
     * @param  list<array<string, mixed>>  $watched
     * @param  array<string, mixed>  $snapshot
     * @return list<array<string, mixed>>
     */
    private function alarm(array $settings, array $collected, array $watched, array &$snapshot): array
    {
        $previous = [];
        foreach ($snapshot['trunks'] as $trunk) {
            $previous[] = [
                'id' => (string) $trunk['id'],
                'alarmHealth' => (string) ($trunk['alarmHealth'] ?? $trunk['health'] ?? 'unknown'),
                'alarming' => (bool) ($trunk['alarming'] ?? false),
                'downSince' => is_string($trunk['downSince'] ?? null) ? $trunk['downSince'] : null,
                'lastAlertAt' => is_string($trunk['lastAlertAt'] ?? null) ? $trunk['lastAlertAt'] : null,
            ];
        }

        $updates = Status::evaluateAlarms($previous, $watched, [
            'alertOnDegraded' => $settings['alertOnDegraded'],
            'alertOnStartup' => $settings['alertOnStartup'],
            'alertOnRecovery' => $settings['alertOnRecovery'],
            'reminderMinutes' => $settings['reminderMinutes'],
            'now' => $this->now,
        ]);
        $byId = [];
        foreach ($updates as $update) {
            $byId[$update['id']] = $update;
        }

        $stored = [];
        foreach ($watched as $trunk) {
            $stored[] = $this->storedTrunk($trunk, $byId[(string) $trunk['id']] ?? null);
        }

        foreach ($updates as $update) {
            if ($update['transition'] === null) {
                continue;
            }
            $trunk = $update['transition']['trunk'];
            $mail = MailText::trunk([
                'kind' => (string) $update['transition']['kind'],
                'trunk' => $trunk,
                'previousHealth' => $update['transition']['previousHealth'],
                'sbcName' => (string) (($trunk['sbcName'] ?? '') !== '' ? $trunk['sbcName'] : $collected['name']),
                'sbcHost' => (string) (($trunk['sbcHost'] ?? '') !== '' ? $trunk['sbcHost'] : $collected['host']),
                'downSince' => (string) $update['transition']['downSince'],
                'now' => $this->now,
            ]);
            $this->record(
                $snapshot,
                (string) $update['transition']['kind'],
                (string) $update['id'],
                (string) ($trunk['name'] ?? ''),
                $mail['subject'],
                $mail['text'],
                $this->deliver($settings['alertRecipients'], (string) $update['transition']['kind'], $mail, (string) ($trunk['sbcHost'] ?? '')),
            );
        }

        return $stored;
    }

    /**
     * @param  array<string, mixed>  $settings
     * @param  array<string, mixed>  $snapshot
     */
    private function reachable(array $settings, array &$snapshot, string $name, string $host, string $detail, int $failures): void
    {
        $mail = MailText::reachability([
            'kind' => 'reachable',
            'sbcName' => $name,
            'sbcHost' => $host,
            'detail' => $detail,
            'failures' => $failures,
            'now' => $this->now,
        ]);
        $this->record(
            $snapshot,
            'reachable',
            null,
            null,
            $mail['subject'],
            $mail['text'],
            $this->deliver($settings['alertRecipients'], 'reachable', $mail, $host),
        );
    }

    /**
     * @param  array<string, mixed>  $trunk
     * @param  array<string, mixed>|null  $update
     * @return array<string, mixed>
     */
    private function storedTrunk(array $trunk, ?array $update): array
    {
        $calls = is_array($trunk['calls'] ?? null) ? $trunk['calls'] : Xml::emptyCalls();
        $peers = [];
        foreach (is_array($trunk['peers'] ?? null) ? $trunk['peers'] : [] as $peer) {
            $peers[] = (string) $peer;
        }

        return [
            'id' => (string) $trunk['id'],
            'sbcId' => (string) ($trunk['sbcId'] ?? ''),
            'sbcName' => (string) ($trunk['sbcName'] ?? ''),
            'sbcHost' => (string) ($trunk['sbcHost'] ?? ''),
            'sgId' => (string) (($trunk['sgId'] ?? '') !== '' ? $trunk['sgId'] : $trunk['id']),
            'name' => (string) ($trunk['name'] ?? 'Signaling group'),
            'health' => (string) ($trunk['health'] ?? 'unknown'),
            'rawStatus' => (string) ($trunk['rawStatus'] ?? 'unknown'),
            'statusLabel' => (string) ($trunk['statusLabel'] ?? 'Unknown'),
            'adminState' => (string) ($trunk['adminState'] ?? 'unknown'),
            'channels' => is_numeric($trunk['channels'] ?? null) ? (int) $trunk['channels'] : null,
            'currentCalls' => is_numeric($trunk['currentCalls'] ?? null) ? (int) $trunk['currentCalls'] : null,
            'calls' => $calls,
            'peers' => $peers,
            'interop' => (string) ($trunk['interop'] ?? ''),
            'protocol' => (string) ($trunk['protocol'] ?? ''),
            'downSince' => $update['downSince'] ?? null,
            'lastAlertAt' => $update['lastAlertAt'] ?? null,
            'alarmHealth' => (string) ($update['alarmHealth'] ?? ($trunk['health'] ?? 'unknown')),
            'alarming' => (bool) ($update['alarming'] ?? false),
            'updatedAt' => $this->stamp(),
        ];
    }

    /**
     * @param  array{subject:string,text:string}  $mail
     * @return array{status:string,detail:string}
     */
    private function deliver(string $recipients, string $kind, array $mail, ?string $host): array
    {
        try {
            $result = ($this->notify)($recipients, $kind, $mail['subject'], $mail['text'], $host);
            $status = is_string($result['status'] ?? null) ? $result['status'] : 'skipped';

            return [
                'status' => $status,
                'detail' => is_string($result['detail'] ?? null) ? $result['detail'] : '',
            ];
        } catch (\Throwable $error) {
            return ['status' => 'failed', 'detail' => $error->getMessage()];
        }
    }

    /**
     * @param  array<string, mixed>  $snapshot
     * @param  array{status:string,detail:string}  $delivery
     */
    private function record(array &$snapshot, string $kind, ?string $trunkId, ?string $trunkName, string $subject, string $text, array $delivery): void
    {
        $snapshot['events'][] = [
            'at' => $this->stamp(),
            'kind' => $kind,
            'trunkId' => $trunkId,
            'trunkName' => $trunkName,
            'subject' => $subject,
            'body' => $text,
            'emailStatus' => $delivery['status'],
            'emailDetail' => $delivery['detail'],
        ];
    }

    private function due(?string $lastPollAt, int $interval): bool
    {
        if ($lastPollAt === null || $lastPollAt === '') {
            return true;
        }
        $elapsed = Status::elapsed($this->now, $lastPollAt);

        return $elapsed === null || $elapsed >= $interval;
    }

    private function stamp(): string
    {
        return $this->now->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d\TH:i:s.v\Z');
    }
}
