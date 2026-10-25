<?php

declare(strict_types=1);

namespace App\Plugins\RibbonTrunks\Support;

final class FileSnapshot
{
    public function __construct(private readonly string $path) {}

    /**
     * @return array{
     *     lastPollAt:?string,
     *     lastSuccessAt:?string,
     *     lastError:?string,
     *     consecutiveFailures:int,
     *     trunks:list<array<string, mixed>>,
     *     runtimes:array<string, array<string, mixed>>,
     *     events:list<array<string, mixed>>
     * }
     */
    public static function blank(): array
    {
        return [
            'lastPollAt' => null,
            'lastSuccessAt' => null,
            'lastError' => null,
            'consecutiveFailures' => 0,
            'trunks' => [],
            'runtimes' => [],
            'events' => [],
        ];
    }

    /**
     * @return array{
     *     lastPollAt:?string,
     *     lastSuccessAt:?string,
     *     lastError:?string,
     *     consecutiveFailures:int,
     *     trunks:list<array<string, mixed>>,
     *     runtimes:array<string, array<string, mixed>>,
     *     events:list<array<string, mixed>>
     * }
     */
    public function read(): array
    {
        $blank = self::blank();
        if (! is_file($this->path)) {
            return $blank;
        }
        $raw = @file_get_contents($this->path);
        if (! is_string($raw) || $raw === '') {
            return $blank;
        }
        $decoded = json_decode($raw, true);
        if (! is_array($decoded)) {
            return $blank;
        }

        $trunks = [];
        if (isset($decoded['trunks']) && is_array($decoded['trunks'])) {
            foreach ($decoded['trunks'] as $trunk) {
                if (is_array($trunk) && isset($trunk['id'])) {
                    $trunks[] = $trunk;
                }
            }
        }

        $runtimes = [];
        if (isset($decoded['runtimes']) && is_array($decoded['runtimes'])) {
            foreach ($decoded['runtimes'] as $id => $runtime) {
                if (is_string($id) && is_array($runtime)) {
                    $runtimes[$id] = $runtime;
                }
            }
        }

        $events = [];
        if (isset($decoded['events']) && is_array($decoded['events'])) {
            foreach ($decoded['events'] as $event) {
                if (is_array($event)) {
                    $events[] = $event;
                }
            }
        }

        return [
            'lastPollAt' => is_string($decoded['lastPollAt'] ?? null) ? $decoded['lastPollAt'] : null,
            'lastSuccessAt' => is_string($decoded['lastSuccessAt'] ?? null) ? $decoded['lastSuccessAt'] : null,
            'lastError' => is_string($decoded['lastError'] ?? null) ? $decoded['lastError'] : null,
            'consecutiveFailures' => is_numeric($decoded['consecutiveFailures'] ?? null) ? (int) $decoded['consecutiveFailures'] : 0,
            'trunks' => $trunks,
            'runtimes' => $runtimes,
            'events' => $events,
        ];
    }

    /**
     * @param  array<string, mixed>  $data
     */
    public function write(array $data): void
    {
        $directory = dirname($this->path);
        if (! is_dir($directory) && ! mkdir($directory, 0775, true) && ! is_dir($directory)) {
            throw new \RuntimeException('Could not create '.$directory.' for the trunk snapshot.');
        }
        $json = json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
        if ($json === false) {
            throw new \RuntimeException('Could not encode the trunk snapshot.');
        }
        $temporary = $this->path.'.tmp';
        if (file_put_contents($temporary, $json.PHP_EOL, LOCK_EX) === false) {
            throw new \RuntimeException('Could not write the trunk snapshot.');
        }
        if (! rename($temporary, $this->path)) {
            throw new \RuntimeException('Could not replace the trunk snapshot.');
        }
    }
}
