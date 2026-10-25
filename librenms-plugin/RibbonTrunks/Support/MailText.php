<?php

declare(strict_types=1);

namespace App\Plugins\RibbonTrunks\Support;

use DateTimeImmutable;
use DateTimeZone;

final class MailText
{
    /**
     * @param  array{
     *     kind:string,
     *     trunk:array<string, mixed>,
     *     previousHealth:?string,
     *     sbcName:string,
     *     sbcHost:string,
     *     downSince:string,
     *     now:DateTimeImmutable
     * }  $input
     * @return array{subject:string,text:string}
     */
    public static function trunk(array $input): array
    {
        $trunk = $input['trunk'];
        $kind = $input['kind'];
        $name = (string) ($trunk['name'] ?? 'Signaling group');
        $sbc = $input['sbcName'] !== '' ? $input['sbcName'] : ($input['sbcHost'] !== '' ? $input['sbcHost'] : 'Ribbon SBC Edge');
        $prefix = match ($kind) {
            'recovery' => 'RECOVERED',
            'reminder' => 'STILL DOWN',
            default => 'DOWN',
        };
        $headline = match ($kind) {
            'recovery' => $name.' recovered',
            'reminder' => $name.' is still down',
            default => $name.' is down',
        };
        $calls = is_array($trunk['calls'] ?? null) ? $trunk['calls'] : Xml::emptyCalls();
        $peers = is_array($trunk['peers'] ?? null) ? $trunk['peers'] : [];
        $sgId = (string) (($trunk['sgId'] ?? '') !== '' ? $trunk['sgId'] : ($trunk['id'] ?? ''));
        $lines = [
            $headline,
            '',
            'Signaling group: '.$name.' (id '.$sgId.')',
            'State: '.($trunk['statusLabel'] ?? '').' ('.($trunk['rawStatus'] ?? '').')',
            'Previous: '.($input['previousHealth'] ?? 'first observation'),
            'SBC: '.$sbc.($input['sbcHost'] !== '' ? ' ('.$input['sbcHost'].')' : ''),
            'Admin: '.($trunk['adminState'] ?? ''),
            'Channels: '.self::count($trunk['channels'] ?? null),
            'Active calls: '.self::count($trunk['currentCalls'] ?? null)
                .' ('.self::count($calls['ingressCurrent'] ?? null).' in, '
                .self::count($calls['egressCurrent'] ?? null).' out, '
                .self::count($calls['connected'] ?? null).' connected)',
            'Peers: '.($peers === [] ? 'none reported' : implode(', ', array_map('strval', $peers))),
            'Listen: '.(((string) ($trunk['protocol'] ?? '')) !== '' ? $trunk['protocol'] : 'not reported'),
            'Interop: '.(((string) ($trunk['interop'] ?? '')) !== '' ? $trunk['interop'] : 'not reported'),
            'Down since: '.self::format(self::parse($input['downSince'], $input['now'])),
            'Time: '.self::format($input['now']),
            '',
            $kind === 'recovery'
                ? 'The signaling group has left the alarm state.'
                : 'Another message is sent when the trunk recovers.',
        ];

        return [
            'subject' => '[Ribbon trunks] '.$prefix.': '.$name.' on '.$sbc,
            'text' => implode("\n", $lines),
        ];
    }

    /**
     * @param  array{kind:string,sbcName:string,sbcHost:string,detail:string,failures:int,now:DateTimeImmutable}  $input
     * @return array{subject:string,text:string}
     */
    public static function reachability(array $input): array
    {
        $sbc = $input['sbcName'] !== '' ? $input['sbcName'] : ($input['sbcHost'] !== '' ? $input['sbcHost'] : 'Ribbon SBC Edge');
        $prefix = match ($input['kind']) {
            'reachable' => 'SBC REACHABLE',
            'reminder' => 'SBC STILL UNREACHABLE',
            default => 'SBC UNREACHABLE',
        };
        $lines = [
            $input['kind'] === 'reachable' ? $sbc.' is reachable again' : $sbc.' could not be polled',
            '',
            'SBC: '.$sbc.($input['sbcHost'] !== '' ? ' ('.$input['sbcHost'].')' : ''),
            'Consecutive failures: '.$input['failures'],
            'Detail: '.($input['detail'] !== '' ? $input['detail'] : 'none'),
            'Time: '.self::format($input['now']),
            '',
            $input['kind'] === 'reachable'
                ? 'Polling succeeded. Trunk alarms resume from the new snapshot.'
                : 'Trunk states were left unchanged so a network failure does not look like a trunk outage.',
        ];

        return [
            'subject' => '[Ribbon trunks] '.$prefix.': '.$sbc,
            'text' => implode("\n", $lines),
        ];
    }

    private static function count(mixed $value): string
    {
        return is_int($value) || is_float($value) ? (string) $value : 'unknown';
    }

    private static function parse(string $value, DateTimeImmutable $now): DateTimeImmutable
    {
        try {
            return (new DateTimeImmutable($value))->setTimezone($now->getTimezone());
        } catch (\Throwable) {
            return $now;
        }
    }

    private static function format(DateTimeImmutable $date): string
    {
        try {
            return $date->format('M j, Y g:i:s A T');
        } catch (\Throwable) {
            return $date->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d\TH:i:s\Z');
        }
    }
}
