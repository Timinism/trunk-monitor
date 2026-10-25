<div class="panel panel-default">
    <div class="panel-heading">
        <div class="row">
            <div class="col-sm-8">
                <h3 style="margin: 4px 0;">Ribbon trunks</h3>
                <p class="text-muted" style="margin: 0;">SIP signaling groups on Ribbon SBC Edge. Select a trunk to see peers, channels, and call counters. The poller only reads the appliance.</p>
            </div>
            <div class="col-sm-4 text-right" style="margin-top: 8px;">
                @if($canAdmin)
                    <a class="btn btn-primary btn-sm" href="{{ route('plugin.page', ['plugin' => 'RibbonTrunks', 'poll' => 1]) }}">Poll now</a>
                    <a class="btn btn-default btn-sm" href="{{ route('plugin.settings', ['plugin' => 'RibbonTrunks']) }}">Settings</a>
                @endif
            </div>
        </div>
    </div>
    <div class="panel-body">
        @if($polled)
            <div class="alert alert-info">Polled just now.</div>
        @endif
        @if($pollError)
            <div class="alert alert-danger">{{ $pollError }}</div>
        @endif
        @if($lastError)
            <div class="alert alert-warning">{{ $lastError }}</div>
        @endif

        @if(!$configured)
            <p>No Ribbon SBC is configured. An admin can add appliances under plugin settings. Each one needs a REST username created in the SBC web UI.</p>
        @else
            <p>
                <span class="label label-success">{{ $summary['up'] }} up</span>
                <span class="label label-danger">{{ $summary['down'] }} down</span>
                <span class="label label-warning">{{ $summary['degraded'] }} draining</span>
                <span class="label label-default">{{ $summary['disabled'] }} disabled</span>
                <span class="text-muted">Last poll {{ $lastPoll }}. Last success {{ $lastSuccess }}.</span>
            </p>

            @forelse($groups as $group)
                <section style="margin-bottom: 16px;">
                    @if($multiple || $group['error'] || !$group['enabled'])
                        <h4 style="margin-bottom: 4px;">
                            {{ $group['title'] }}
                            @if(!$group['enabled'])
                                <span class="label label-default">Disabled</span>
                            @endif
                        </h4>
                        <p class="text-muted" style="margin-top: 0;">
                            {{ $group['host'] }}
                            @if($group['version'] !== '')
                                · {{ $group['version'] }}
                            @endif
                        </p>
                        @if($group['error'])
                            <div class="alert alert-warning">{{ $group['error'] }}</div>
                        @endif
                    @endif

                    @forelse($group['trunks'] as $trunk)
                        <details class="ribbon-trunk">
                            <summary>
                                <span class="twist" aria-hidden="true">▸</span>
                                <span class="label ribbon-status {{ $trunk['labelClass'] }}">{{ $trunk['statusLabel'] }}</span>
                                <span class="name">{{ $trunk['name'] }}</span>
                            </summary>
                            <div class="ribbon-detail">
                                <div class="row">
                                    <div class="col-sm-7">
                                        <p style="margin-bottom: 4px;">SG {{ $trunk['sgId'] !== '' ? $trunk['sgId'] : $trunk['id'] }}</p>
                                        <p class="text-muted">
                                            {{ count($trunk['peers']) ? implode(' · ', $trunk['peers']) : 'No SIP server table' }}
                                            @if($trunk['protocol'] !== '')
                                                · {{ $trunk['protocol'] }}
                                            @endif
                                            @if($trunk['interop'] !== '')
                                                · {{ $trunk['interop'] }}
                                            @endif
                                        </p>
                                    </div>
                                    <div class="col-sm-5 text-right">
                                        <p style="margin-bottom: 4px;">
                                            <strong>{{ $trunk['currentCalls'] === null ? '—' : $trunk['currentCalls'] }}</strong>
                                            active / {{ $trunk['channels'] === null ? '—' : $trunk['channels'] }} channels
                                        </p>
                                        <p class="text-muted" style="text-transform: capitalize;">Admin {{ $trunk['adminState'] }}</p>
                                        @if($trunk['downSince'])
                                            <p class="text-danger">Down since {{ $trunk['downSince'] }}</p>
                                        @endif
                                    </div>
                                </div>
                                @if($trunk['usedPercent'] !== null)
                                    <div class="progress" style="height: 6px; margin: 8px 0 0;">
                                        <div class="progress-bar" style="width: {{ $trunk['usedPercent'] }}%;"></div>
                                    </div>
                                @endif
                                @if($trunk['hasCalls'])
                                    <div class="ribbon-metrics">
                                        @foreach([
                                            'In' => $trunk['calls']['ingressCurrent'] ?? null,
                                            'Out' => $trunk['calls']['egressCurrent'] ?? null,
                                            'Connected' => $trunk['calls']['connected'] ?? null,
                                            'Total' => $trunk['calls']['total'] ?? null,
                                            'Refused' => $trunk['calls']['refused'] ?? null,
                                            'Blocked' => $trunk['calls']['blocked'] ?? null,
                                            'Errored' => $trunk['calls']['errored'] ?? null,
                                            'In attempts' => $trunk['calls']['ingressAttempts'] ?? null,
                                            'In accepted' => $trunk['calls']['ingressAccepted'] ?? null,
                                            'In completed' => $trunk['calls']['ingressCompleted'] ?? null,
                                            'In rejected' => $trunk['calls']['ingressRejected'] ?? null,
                                            'In blocked' => $trunk['calls']['ingressBlocked'] ?? null,
                                            'Out attempts' => $trunk['calls']['egressAttempts'] ?? null,
                                            'Out accepted' => $trunk['calls']['egressAccepted'] ?? null,
                                            'Out completed' => $trunk['calls']['egressCompleted'] ?? null,
                                            'Out rejected' => $trunk['calls']['egressRejected'] ?? null,
                                            'Out blocked' => $trunk['calls']['egressBlocked'] ?? null,
                                        ] as $label => $value)
                                            <div class="ribbon-metric">
                                                <span>{{ $label }}</span>
                                                <strong>{{ $value === null ? '—' : number_format((int) $value) }}</strong>
                                            </div>
                                        @endforeach
                                    </div>
                                @endif
                            </div>
                        </details>
                    @empty
                        <p class="text-muted">No signaling groups on the last poll.</p>
                    @endforelse
                </section>
            @empty
                <p class="text-muted">No signaling groups yet.</p>
            @endforelse
        @endif
    </div>
</div>

@if(count($events) > 0)
    <div class="panel panel-default">
        <div class="panel-heading"><h4 style="margin: 0;">Recent alerts</h4></div>
        <ul class="list-group">
            @foreach($events as $event)
                <li class="list-group-item">
                    <span class="label {{ ($event['emailStatus'] ?? '') === 'sent' ? 'label-success' : (($event['emailStatus'] ?? '') === 'failed' ? 'label-danger' : 'label-default') }}">
                        {{ $event['emailStatus'] ?? 'skipped' }}
                    </span>
                    {{ $event['subject'] ?? '' }}
                    <span class="text-muted">{{ $event['when'] ?? '' }}</span>
                </li>
            @endforeach
        </ul>
    </div>
@endif

<style>
    .ribbon-trunk { border-top: 1px solid rgba(128, 128, 128, .25); }
    .ribbon-trunk summary {
        display: flex;
        align-items: center;
        gap: 8px;
        cursor: pointer;
        padding: 10px 4px;
        list-style: none;
    }
    .ribbon-trunk summary::-webkit-details-marker { display: none; }
    .ribbon-trunk summary .twist { width: 1em; color: #888; }
    .ribbon-trunk[open] summary .twist { transform: rotate(90deg); }
    .ribbon-trunk summary .name { font-weight: 600; min-width: 0; }
    .ribbon-status { min-width: 5.5em; text-align: center; }
    .ribbon-detail { padding: 0 4px 12px 1.6em; }
    .ribbon-metrics {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(96px, 1fr));
        gap: 8px;
        margin-top: 12px;
    }
    .ribbon-metric {
        border: 1px solid rgba(128, 128, 128, .25);
        border-radius: 4px;
        padding: 6px 8px;
    }
    .ribbon-metric span {
        display: block;
        color: #777;
        font-size: 11px;
        letter-spacing: .04em;
        text-transform: uppercase;
    }
    @media (max-width: 640px) {
        .ribbon-trunk summary { flex-wrap: wrap; }
        .text-right { text-align: left; }
    }
</style>
