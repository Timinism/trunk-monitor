<?php

declare(strict_types=1);

namespace App\Plugins\RibbonTrunks\Support;

use DateTimeImmutable;
use DateTimeZone;

final class Status
{
    /** @var array<string, string> */
    private const STATUS_BY_KEY = [
        '0' => 'sgsUP',
        '1' => 'sgsDOWN',
        '2' => 'sgsUpDraining',
        '3' => 'sgsUpDrained',
        '4' => 'sgsUpPeersDown',
        '5' => 'sgsNONE_EXISTS',
        'sgsup' => 'sgsUP',
        'sgsdown' => 'sgsDOWN',
        'sgsupdraining' => 'sgsUpDraining',
        'sgsupdrained' => 'sgsUpDrained',
        'sgsuppeersdown' => 'sgsUpPeersDown',
        'sgsnone_exists' => 'sgsNONE_EXISTS',
        'sgsnoneexists' => 'sgsNONE_EXISTS',
    ];

    /** @var array<string, string> */
    private const ADMIN_BY_KEY = [
        '0' => 'disabled',
        '1' => 'enabled',
        '2' => 'drain',
        'cmcustomdisabled' => 'disabled',
        'cmcustomenabled' => 'enabled',
        'cmcustomdrain' => 'drain',
        'disabled' => 'disabled',
        'enabled' => 'enabled',
        'drain' => 'drain',
    ];

    public static function normalizeStatus(string $raw): string
    {
        $key = strtolower(trim($raw));
        if ($key === '') {
            return 'unknown';
        }

        return self::STATUS_BY_KEY[$key] ?? 'unknown';
    }

    public static function normalizeAdmin(string $raw): string
    {
        $key = strtolower(trim($raw));
        if ($key === '') {
            return 'unknown';
        }

        return self::ADMIN_BY_KEY[$key] ?? 'unknown';
    }

    public static function classifyHealth(string $status, string $admin): string
    {
        if ($admin === 'disabled') {
            return 'disabled';
        }

        return match ($status) {
            'sgsUP' => 'up',
            'sgsUpDraining', 'sgsUpDrained' => 'degraded',
            'sgsDOWN', 'sgsUpPeersDown', 'sgsNONE_EXISTS' => 'down',
            default => 'unknown',
        };
    }

    public static function statusLabel(string $health, string $status): string
    {
        if ($health === 'disabled') {
            return 'Disabled';
        }

        return match ($status) {
            'sgsUP' => 'Up',
            'sgsDOWN' => 'Down',
            'sgsUpDraining' => 'Draining',
            'sgsUpDrained' => 'Drained',
            'sgsUpPeersDown' => 'Peers down',
            'sgsNONE_EXISTS' => 'Not present',
            default => 'Unknown',
        };
    }

    public static function isAlarming(string $health, bool $alertOnDegraded): bool
    {
        if ($health === 'down') {
            return true;
        }

        return $health === 'degraded' && $alertOnDegraded;
    }

    /**
     * @param  list<array{id:string,alarmHealth:string,alarming:bool,downSince:?string,lastAlertAt:?string}>  $previous
     * @param  list<array<string, mixed>>  $current
     * @param  array{alertOnDegraded:bool,alertOnStartup:bool,alertOnRecovery:bool,reminderMinutes:int,now:DateTimeImmutable}  $options
     * @return list<array{id:string,alarmHealth:string,alarming:bool,downSince:?string,lastAlertAt:?string,transition:?array<string, mixed>}>
     */
    public static function evaluateAlarms(array $previous, array $current, array $options): array
    {
        $prevById = [];
        foreach ($previous as $item) {
            $prevById[$item['id']] = $item;
        }

        $nowIso = self::stamp($options['now']);
        $updates = [];

        foreach ($current as $trunk) {
            $id = (string) $trunk['id'];
            $prev = $prevById[$id] ?? null;
            $health = (string) ($trunk['health'] ?? 'unknown');

            if ($health === 'unknown') {
                $updates[] = [
                    'id' => $id,
                    'alarmHealth' => $prev['alarmHealth'] ?? 'unknown',
                    'alarming' => $prev['alarming'] ?? false,
                    'downSince' => $prev['downSince'] ?? null,
                    'lastAlertAt' => $prev['lastAlertAt'] ?? null,
                    'transition' => null,
                ];
                continue;
            }

            $alarming = self::isAlarming($health, $options['alertOnDegraded']);
            $wasAlarming = $prev['alarming'] ?? false;
            $downSince = $prev['downSince'] ?? null;
            $lastAlertAt = $prev['lastAlertAt'] ?? null;
            $transition = null;

            if ($prev === null) {
                if ($alarming) {
                    $downSince = $nowIso;
                    if ($options['alertOnStartup']) {
                        $lastAlertAt = $nowIso;
                        $transition = [
                            'kind' => 'down',
                            'trunk' => $trunk,
                            'previousHealth' => null,
                            'downSince' => $downSince,
                        ];
                    }
                }
            } elseif ($alarming && ! $wasAlarming) {
                $downSince = $nowIso;
                $lastAlertAt = $nowIso;
                $transition = [
                    'kind' => 'down',
                    'trunk' => $trunk,
                    'previousHealth' => $prev['alarmHealth'],
                    'downSince' => $downSince,
                ];
            } elseif (! $alarming && $wasAlarming) {
                $since = $prev['downSince'] ?? $nowIso;
                if ($options['alertOnRecovery']) {
                    $transition = [
                        'kind' => 'recovery',
                        'trunk' => $trunk,
                        'previousHealth' => $prev['alarmHealth'],
                        'downSince' => $since,
                    ];
                    $lastAlertAt = $nowIso;
                }
                $downSince = null;
            } elseif ($alarming && $wasAlarming && $options['reminderMinutes'] > 0) {
                $anchor = $lastAlertAt ?? $downSince;
                if (is_string($anchor) && $anchor !== '') {
                    $elapsed = self::elapsed($options['now'], $anchor);
                    if ($elapsed !== null && $elapsed >= $options['reminderMinutes'] * 60) {
                        $lastAlertAt = $nowIso;
                        $transition = [
                            'kind' => 'reminder',
                            'trunk' => $trunk,
                            'previousHealth' => $prev['alarmHealth'],
                            'downSince' => $downSince ?? $nowIso,
                        ];
                    }
                }
            }

            $updates[] = [
                'id' => $id,
                'alarmHealth' => $health,
                'alarming' => $alarming,
                'downSince' => $downSince,
                'lastAlertAt' => $lastAlertAt,
                'transition' => $transition,
            ];
        }

        return $updates;
    }

    /**
     * @param  array{id?:string,name?:string,sgId?:string}  $trunk
     */
    public static function matchesWatchFilter(array $trunk, string $filter): bool
    {
        $tokens = array_values(array_filter(array_map(
            static fn (string $token): string => strtolower(trim($token)),
            preg_split('/[,;\n]/', $filter) ?: [],
        ), static fn (string $token): bool => $token !== ''));

        if ($tokens === []) {
            return true;
        }

        $id = strtolower((string) ($trunk['id'] ?? ''));
        $sgId = strtolower((string) ($trunk['sgId'] ?? ''));
        $name = strtolower((string) ($trunk['name'] ?? ''));

        foreach ($tokens as $token) {
            if ($id === $token || $sgId === $token || str_contains($name, $token)) {
                return true;
            }
        }

        return false;
    }

    public static function stamp(DateTimeImmutable $now): string
    {
        return $now->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d\TH:i:s.v\Z');
    }

    public static function elapsed(DateTimeImmutable $now, string $anchor): ?int
    {
        try {
            $then = new DateTimeImmutable($anchor);
        } catch (\Throwable) {
            return null;
        }

        return $now->getTimestamp() - $then->getTimestamp();
    }
}
