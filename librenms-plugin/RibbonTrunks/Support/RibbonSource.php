<?php

declare(strict_types=1);

namespace App\Plugins\RibbonTrunks\Support;

final class RibbonSource
{
    /**
     * @param  array{id:string,name:string,host:string,port:int,username:string,password:string,tlsVerify:bool,enabled:bool}  $sbc
     * @return array{name:string,version:string,host:string,trunks:list<array<string, mixed>>}
     */
    public function collect(array $sbc): array
    {
        $base = Url::restBase($sbc['host'], $sbc['port']);
        $client = new RibbonClient($base, $sbc['username'], $sbc['password'], $sbc['tlsVerify']);

        try {
            $system = $client->system();
        } catch (\Throwable) {
            $system = ['name' => '', 'version' => ''];
        }

        $name = $system['name'] !== '' ? $system['name'] : Config::label($sbc);
        $trunks = [];
        foreach ($client->signalingGroups() as $trunk) {
            $sgId = (string) (($trunk['sgId'] ?? '') !== '' ? $trunk['sgId'] : $trunk['id']);
            $trunk['sgId'] = $sgId;
            $trunk['id'] = $sbc['id'].':'.$sgId;
            $trunk['sbcId'] = $sbc['id'];
            $trunk['sbcName'] = $name;
            $trunk['sbcHost'] = $sbc['host'];
            $trunks[] = $trunk;
        }

        return [
            'name' => $name,
            'version' => $system['version'],
            'host' => $sbc['host'],
            'trunks' => $trunks,
        ];
    }
}
