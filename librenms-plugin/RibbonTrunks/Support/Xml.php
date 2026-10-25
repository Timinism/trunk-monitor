<?php

declare(strict_types=1);

namespace App\Plugins\RibbonTrunks\Support;

use DOMDocument;
use DOMElement;
use DOMNode;

final class Xml
{
    /** @var array<string, string> */
    private const CALL_FIELDS = [
        'ingressCurrent' => 'rt_NumIngressCurrentCalls',
        'egressCurrent' => 'rt_NumEgressCurrentCalls',
        'connected' => 'rt_NumConnectedCalls',
        'total' => 'rt_NumTotalCalls',
        'refused' => 'rt_NumRefusedCalls',
        'blocked' => 'rt_NumBlockedCalls',
        'errored' => 'rt_NumErroredCalls',
        'ingressAttempts' => 'rt_NumIngressCallAttempts',
        'ingressAccepted' => 'rt_NumIngressCallsAccepted',
        'ingressCompleted' => 'rt_NumIngressCallsCompleted',
        'ingressRejected' => 'rt_NumIngressCallsRejected',
        'ingressBlocked' => 'rt_NumIngressCallsBlocked',
        'egressAttempts' => 'rt_NumEgressCallAttempts',
        'egressAccepted' => 'rt_NumEgressCallsAccepted',
        'egressCompleted' => 'rt_NumEgressCallsCompleted',
        'egressRejected' => 'rt_NumEgressCallsRejected',
        'egressBlocked' => 'rt_NumEgressCallsBlocked',
    ];

    /** @var array<string, string> */
    private const PROTOCOLS = [
        '1' => 'UDP',
        '2' => 'TCP',
        '3' => 'TCP/UDP',
        '4' => 'TLS',
        '5' => 'TLS/UDP',
        '6' => 'TLS/TCP',
        '7' => 'TLS/TCP/UDP',
        'etrudp' => 'UDP',
        'etrtcp' => 'TCP',
        'etrtcp_udp' => 'TCP/UDP',
        'etrtls' => 'TLS',
        'etrtls_udp' => 'TLS/UDP',
        'etrtls_tcp' => 'TLS/TCP',
        'etrtls_tcp_udp' => 'TLS/TCP/UDP',
    ];

    /** @var array<string, string> */
    private const INTEROP = [
        '0' => 'Standard',
        '1' => 'BroadSoft',
        '2' => 'Office 365',
        '3' => 'Office 365 with AD',
        '4' => 'Header transparency',
        'estandard' => 'Standard',
        'ebroadsoft' => 'BroadSoft',
        'eo365' => 'Office 365',
        'eo365wad' => 'Office 365 with AD',
        'eheadertransparency' => 'Header transparency',
    ];

    /**
     * @return array<string, int|null>
     */
    public static function emptyCalls(): array
    {
        $calls = [];
        foreach (array_keys(self::CALL_FIELDS) as $key) {
            $calls[$key] = null;
        }

        return $calls;
    }

    /**
     * @return array{httpCode:int|null,appCode:string|null}
     */
    public static function apiStatus(string $xml): array
    {
        $root = self::document($xml);
        $httpCode = null;
        $appCode = null;

        $walk = static function (DOMNode $node) use (&$walk, &$httpCode, &$appCode): void {
            if ($node instanceof DOMElement) {
                if ($httpCode === null && strcasecmp($node->localName, 'http_code') === 0) {
                    $parsed = trim($node->textContent);
                    if (is_numeric($parsed)) {
                        $httpCode = (int) $parsed;
                    }
                }
                if ($appCode === null && strcasecmp($node->localName, 'app_status_entry') === 0) {
                    $code = trim($node->getAttribute('code'));
                    if ($code !== '') {
                        $appCode = $code;
                    }
                }
            }
            foreach ($node->childNodes as $child) {
                $walk($child);
            }
        };
        $walk($root);

        return ['httpCode' => $httpCode, 'appCode' => $appCode];
    }

    /**
     * @return list<array<string, mixed>>
     */
    public static function signalingGroups(string $xml): array
    {
        $root = self::document($xml);
        $groups = [];
        $seen = [];

        foreach (self::collect($root, 'sipsg') as $node) {
            $id = self::idFrom($node);
            if ($id === '' || isset($seen[$id])) {
                continue;
            }
            $seen[$id] = true;
            $stub = self::isStub($node);
            $rawStatus = Status::normalizeStatus(self::field($node, 'rt_Status'));
            $adminState = Status::normalizeAdmin(self::field($node, 'customAdminState'));
            $health = $stub ? 'unknown' : Status::classifyHealth($rawStatus, $adminState);
            $cluster = self::field($node, 'ServerClusterId');
            $description = self::field($node, 'Description');
            $channels = self::field($node, 'rt_NumberOfChannels');
            if ($channels === '') {
                $channels = self::field($node, 'Channels');
            }

            $groups[] = [
                'id' => $id,
                'sbcId' => '',
                'sbcName' => '',
                'sbcHost' => '',
                'sgId' => $id,
                'name' => $description !== '' ? $description : 'Signaling group '.$id,
                'health' => $health,
                'rawStatus' => $stub ? 'unknown' : $rawStatus,
                'statusLabel' => $stub ? 'Unknown' : Status::statusLabel($health, $rawStatus),
                'adminState' => $stub ? 'unknown' : $adminState,
                'channels' => self::integerOrNull($channels),
                'currentCalls' => self::integerOrNull(self::field($node, 'rt_NumCurrentCalls')),
                'calls' => $stub ? self::emptyCalls() : self::callStats($node),
                'peers' => [],
                'interop' => self::INTEROP[strtolower(self::field($node, 'InteropMode'))] ?? '',
                'protocol' => self::listeners($node),
                'serverClusterId' => $cluster !== '' && $cluster !== '0' ? $cluster : '',
                'stub' => $stub,
            ];
        }

        return $groups;
    }

    /**
     * @return list<string>
     */
    public static function sipServers(string $xml): array
    {
        $root = self::document($xml);
        $peers = [];
        foreach (self::collect($root, 'sipserver') as $server) {
            $host = self::field($server, 'Host');
            if ($host === '') {
                $host = self::field($server, 'rt_RemoteServers');
            }
            if ($host === '' || strtolower($host) === 'none') {
                continue;
            }
            $port = self::field($server, 'Port');
            $label = $port !== '' && $port !== '0' ? $host.':'.$port : $host;
            if (! in_array($label, $peers, true)) {
                $peers[] = $label;
            }
        }

        return $peers;
    }

    /**
     * @return array{name:string,version:string}
     */
    public static function system(string $xml): array
    {
        $systems = self::collect(self::document($xml), 'system');
        $system = $systems[0] ?? null;
        if ($system === null) {
            return ['name' => '', 'version' => ''];
        }

        $name = self::field($system, 'NodeName');
        if ($name === '') {
            $name = self::field($system, 'rt_HostName');
        }
        $base = self::field($system, 'rt_Software_Base_Version');
        $patch = self::field($system, 'rt_Software_Patch_Version');
        $build = self::field($system, 'rt_Software_Base_BuildNumber');
        $parts = array_values(array_filter([
            $base,
            $patch !== '' && $patch !== '0' && strtolower($patch) !== 'none' ? 'patch '.$patch : '',
            $build !== '' ? 'build '.$build : '',
        ], static fn (string $part): bool => $part !== ''));

        return ['name' => $name, 'version' => implode(' ', $parts)];
    }

    private static function document(string $xml): DOMElement
    {
        $cleaned = preg_replace('/^\xEF\xBB\xBF/', '', trim($xml)) ?? trim($xml);
        $dom = self::load($cleaned);
        if ($dom === null) {
            $fixed = preg_replace('/<\?xml([^>?]*)>/i', '<?xml$1?>', $cleaned) ?? $cleaned;
            $dom = self::load($fixed);
        }
        if ($dom === null || $dom->documentElement === null) {
            throw new RibbonException('The SBC returned XML that could not be parsed.');
        }

        return $dom->documentElement;
    }

    private static function load(string $xml): ?DOMDocument
    {
        $previous = libxml_use_internal_errors(true);
        $dom = new DOMDocument();
        $ok = $dom->loadXML($xml, LIBXML_NONET | LIBXML_NOERROR | LIBXML_NOWARNING);
        libxml_clear_errors();
        libxml_use_internal_errors($previous);

        return $ok ? $dom : null;
    }

    /**
     * @return list<DOMElement>
     */
    private static function collect(DOMNode $node, string $name): array
    {
        $found = [];
        if ($node instanceof DOMElement && strcasecmp($node->localName, $name) === 0) {
            $found[] = $node;
        }
        foreach ($node->childNodes as $child) {
            if ($child instanceof DOMElement) {
                foreach (self::collect($child, $name) as $match) {
                    $found[] = $match;
                }
            }
        }

        return $found;
    }

    private static function field(DOMElement $node, string $name): string
    {
        foreach ($node->childNodes as $child) {
            if ($child instanceof DOMElement && strcasecmp($child->localName, $name) === 0) {
                return trim($child->textContent);
            }
        }

        return '';
    }

    private static function idFrom(DOMElement $node): string
    {
        $id = trim($node->getAttribute('id'));
        if ($id !== '') {
            return $id;
        }
        $href = $node->getAttribute('href');
        if (preg_match('~/sipsg/([^/?#]+)~i', $href, $match) === 1) {
            return rawurldecode($match[1]);
        }

        return '';
    }

    private static function isStub(DOMElement $node): bool
    {
        foreach ($node->childNodes as $child) {
            if ($child instanceof DOMElement) {
                return false;
            }
        }

        return true;
    }

    private static function integerOrNull(string $value): ?int
    {
        if (trim($value) === '' || ! is_numeric($value)) {
            return null;
        }

        return (int) $value;
    }

    /**
     * @return array<string, int|null>
     */
    private static function callStats(DOMElement $node): array
    {
        $stats = self::emptyCalls();
        foreach (self::CALL_FIELDS as $key => $field) {
            $stats[$key] = self::integerOrNull(self::field($node, $field));
        }

        return $stats;
    }

    private static function listeners(DOMElement $node): string
    {
        $parts = [];
        for ($index = 1; $index <= 6; $index++) {
            $port = self::field($node, 'ListenPort_'.$index);
            if ($port === '' || $port === '0') {
                continue;
            }
            $protocol = self::PROTOCOLS[strtolower(self::field($node, 'Protocol_'.$index))] ?? '';
            $parts[] = $protocol !== '' ? $protocol.' '.$port : $port;
        }

        return implode(', ', array_slice($parts, 0, 3));
    }
}
