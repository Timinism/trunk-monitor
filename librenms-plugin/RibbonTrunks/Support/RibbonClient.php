<?php

declare(strict_types=1);

namespace App\Plugins\RibbonTrunks\Support;

final class RibbonClient
{
    private const SESSION_TTL_SECONDS = 480;

    private ?string $cookie = null;

    private int $cookieAt = 0;

    public function __construct(
        private readonly string $baseUrl,
        private readonly string $username,
        private readonly string $password,
        private readonly bool $tlsVerify,
    ) {}

    /**
     * @return array{name:string,version:string}
     */
    public function system(): array
    {
        return Xml::system($this->request('system'));
    }

    /**
     * @return list<array<string, mixed>>
     */
    public function signalingGroups(): array
    {
        try {
            $xml = $this->request('sipsg?details=true');
        } catch (RibbonException $error) {
            if ($error->status !== 400) {
                throw $error;
            }
            $xml = $this->request('sipsg');
        }

        $groups = Xml::signalingGroups($xml);
        $stubs = array_values(array_filter($groups, static fn (array $group): bool => (bool) $group['stub']));
        if ($stubs !== []) {
            $detailed = array_values(array_filter($groups, static fn (array $group): bool => ! $group['stub']));
            foreach ($stubs as $stub) {
                $one = $this->request('sipsg/'.rawurlencode((string) $stub['id']));
                foreach (Xml::signalingGroups($one) as $parsed) {
                    if ($parsed['stub']) {
                        continue;
                    }
                    $parsed['id'] = $parsed['id'] !== '' ? $parsed['id'] : $stub['id'];
                    $parsed['sgId'] = $parsed['id'];
                    $parsed['stub'] = false;
                    $detailed[] = $parsed;
                    break;
                }
            }
            $groups = $detailed;
        }

        $clusters = [];
        foreach ($groups as $group) {
            $cluster = (string) $group['serverClusterId'];
            if ($cluster !== '' && ! in_array($cluster, $clusters, true)) {
                $clusters[] = $cluster;
            }
        }

        $peersByCluster = [];
        foreach ($clusters as $clusterId) {
            try {
                $serverXml = $this->request('sipservertable/'.rawurlencode($clusterId).'/sipserver?details=true');
                $peersByCluster[$clusterId] = Xml::sipServers($serverXml);
            } catch (\Throwable) {
                $peersByCluster[$clusterId] = [];
            }
        }

        $trunks = [];
        foreach ($groups as $group) {
            if ($group['stub']) {
                continue;
            }
            $group['peers'] = $peersByCluster[$group['serverClusterId']] ?? [];
            unset($group['stub']);
            $trunks[] = $group;
        }

        return $trunks;
    }

    private function request(string $path, bool $retry = true): string
    {
        $this->login(false);
        $url = $this->baseUrl.'/'.ltrim($path, '/');
        [$status, $text] = $this->execute('GET', $url, null, [
            'Accept: application/xml, text/xml',
            'Cookie: '.($this->cookie ?? ''),
        ]);

        if ($status === 401 && $retry) {
            $this->cookie = null;
            $this->login(true);

            return $this->request($path, false);
        }
        if ($status >= 400) {
            throw new RibbonException('SBC returned HTTP '.$status.' for '.$path.'.', $status);
        }

        $api = Xml::apiStatus($text);
        if ($api['httpCode'] !== null && $api['httpCode'] !== 200) {
            $application = $api['appCode'] !== null ? ' (application '.$api['appCode'].')' : '';
            throw new RibbonException(
                'SBC rejected '.$path.' with code '.$api['httpCode'].$application.'.',
                $api['httpCode'],
            );
        }

        return $text;
    }

    private function login(bool $force): void
    {
        if (! $force && $this->cookie !== null && str_contains($this->cookie, 'PHPSESSID=') && (time() - $this->cookieAt) < self::SESSION_TTL_SECONDS) {
            return;
        }

        $body = http_build_query([
            'Username' => $this->username,
            'Password' => $this->password,
        ]);
        [$status] = $this->execute('POST', $this->baseUrl.'/login', $body, [
            'Content-Type: application/x-www-form-urlencoded',
            'Accept: application/xml, text/xml',
        ]);

        $cookie = $this->cookie ?? '';
        if ($status === 401 || $status === 403 || ! str_contains($cookie, 'PHPSESSID=')) {
            throw new RibbonException(
                'SBC login failed. Check the REST username and password. The account has to be created in the SBC Web UI with the REST access level.',
                $status,
            );
        }
        if ($status >= 400) {
            throw new RibbonException('SBC login returned HTTP '.$status.'.', $status);
        }
        $this->cookieAt = time();
    }

    /**
     * @param  list<string>  $headers
     * @return array{0:int,1:string}
     */
    private function execute(string $method, string $url, ?string $body, array $headers): array
    {
        $scheme = parse_url($url, PHP_URL_SCHEME);
        if ($scheme !== 'https' && $scheme !== 'http') {
            throw new RibbonException('SBC address must use https.');
        }
        if (! function_exists('curl_init')) {
            throw new RibbonException('PHP curl is required to reach the SBC.');
        }

        $handle = curl_init($url);
        if ($handle === false) {
            throw new RibbonException('Could not reach the SBC.');
        }

        $responseHeaders = [];
        $options = [
            CURLOPT_CUSTOMREQUEST => $method,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HEADER => false,
            CURLOPT_TIMEOUT => 20,
            CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_FOLLOWLOCATION => $method === 'GET',
            CURLOPT_MAXREDIRS => 2,
            CURLOPT_SSL_VERIFYPEER => $this->tlsVerify,
            CURLOPT_SSL_VERIFYHOST => $this->tlsVerify ? 2 : 0,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_HEADERFUNCTION => function ($curl, string $header) use (&$responseHeaders): int {
                $responseHeaders[] = $header;

                return strlen($header);
            },
        ];
        if ($body !== null) {
            $options[CURLOPT_POSTFIELDS] = $body;
        }
        curl_setopt_array($handle, $options);

        $payload = curl_exec($handle);
        $errno = curl_errno($handle);
        $error = curl_error($handle);
        $status = (int) curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
        unset($handle);

        if ($payload === false) {
            throw self::explain($errno, $error, $this->tlsVerify);
        }

        $this->storeCookies($responseHeaders);

        return [$status, (string) $payload];
    }

    /**
     * @param  list<string>  $headerLines
     */
    private function storeCookies(array $headerLines): void
    {
        $map = [];
        foreach (explode('; ', (string) $this->cookie) as $part) {
            if (! str_contains($part, '=')) {
                continue;
            }
            [$name, $value] = explode('=', $part, 2);
            $map[$name] = $value;
        }
        foreach ($headerLines as $line) {
            if (stripos($line, 'Set-Cookie:') !== 0) {
                continue;
            }
            $pair = trim(explode(';', trim(substr($line, strlen('Set-Cookie:'))), 2)[0]);
            if (! str_contains($pair, '=')) {
                continue;
            }
            [$name, $value] = explode('=', $pair, 2);
            $map[$name] = $value;
        }
        if ($map === []) {
            return;
        }
        $parts = [];
        foreach ($map as $name => $value) {
            $parts[] = $name.'='.$value;
        }
        $this->cookie = implode('; ', $parts);
    }

    private static function explain(int $errno, string $error, bool $tlsVerify): RibbonException
    {
        $selfSigned = in_array($errno, [
            CURLE_SSL_CACERT,
            CURLE_SSL_CERTPROBLEM,
            CURLE_PEER_FAILED_VERIFICATION,
            CURLE_SSL_CONNECT_ERROR,
        ], true) || preg_match('/self-signed|unable to verify/i', $error) === 1;

        if ($selfSigned) {
            return new RibbonException($tlsVerify
                ? 'TLS certificate verification failed. Ribbon Edge appliances usually present a self-signed certificate. Turn off Verify TLS, or install the SBC certificate on this host.'
                : 'TLS negotiation with the SBC failed.');
        }
        if ($errno === CURLE_COULDNT_RESOLVE_HOST) {
            return new RibbonException('The SBC hostname could not be resolved.');
        }
        if ($errno === CURLE_COULDNT_CONNECT) {
            return new RibbonException('The SBC refused the connection. Check the address, port, and that HTTPS is reachable.');
        }
        if ($errno === CURLE_OPERATION_TIMEDOUT || preg_match('/timeout|aborted/i', $error) === 1) {
            return new RibbonException('The connection to the SBC timed out.');
        }

        return new RibbonException($error !== '' ? $error : 'Could not reach the SBC.');
    }
}
