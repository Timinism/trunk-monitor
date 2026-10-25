<div style="margin: 15px;">
    <h3>Ribbon trunks</h3>
    <p class="text-muted">Add each Ribbon SBC Edge the poller should read. Login is the only request that is not a GET. Mail uses the LibreNMS mail settings and the recipients below. Saving keeps a password only when it is still filled in here, because LibreNMS replaces the whole settings record.</p>

    <form method="post" action="{{ route('plugin.update', ['plugin' => 'RibbonTrunks']) }}" autocomplete="off">
        @csrf

        <div class="panel panel-default">
            <div class="panel-heading"><strong>SBCs</strong></div>
            <div class="panel-body" id="sbc-list">
                @foreach($sbcs as $index => $sbc)
                    @include('RibbonTrunks::resources.views.sbc-fields', ['index' => $index, 'sbc' => $sbc])
                @endforeach
                <p id="sbc-empty" class="text-muted" @if(count($sbcs) > 0) style="display: none;" @endif>No SBCs yet.</p>
            </div>
            <div class="panel-footer">
                <button type="button" class="btn btn-default" id="add-sbc">Add SBC</button>
            </div>
        </div>

        <div class="panel panel-default">
            <div class="panel-heading"><strong>Alerts</strong></div>
            <div class="panel-body">
                <div class="form-group">
                    <label for="alert-recipients">Alert recipients</label>
                    <input id="alert-recipients" class="form-control" type="text" name="settings[alertRecipients]" value="{{ $alertRecipients }}" placeholder="noc@example.com, oncall@example.com">
                    <p class="help-block">Comma or semicolon separated. LibreNMS sends the message with its existing mail transport.</p>
                </div>
                <div class="row">
                    <div class="col-sm-4 form-group">
                        <label for="poll-interval">Poll interval (seconds)</label>
                        <input id="poll-interval" class="form-control" type="number" min="15" max="3600" name="settings[pollIntervalSeconds]" value="{{ $pollIntervalSeconds }}">
                    </div>
                    <div class="col-sm-4 form-group">
                        <label for="unreachable-threshold">Unreachable after failures</label>
                        <input id="unreachable-threshold" class="form-control" type="number" min="1" max="20" name="settings[unreachableThreshold]" value="{{ $unreachableThreshold }}">
                    </div>
                    <div class="col-sm-4 form-group">
                        <label for="reminder-minutes">Remind while down (minutes)</label>
                        <input id="reminder-minutes" class="form-control" type="number" min="0" max="1440" name="settings[reminderMinutes]" value="{{ $reminderMinutes }}">
                        <p class="help-block">0 sends no reminder.</p>
                    </div>
                </div>
                <div class="form-group">
                    <label for="watch-filter">Watch filter</label>
                    <input id="watch-filter" class="form-control" type="text" name="settings[watchFilter]" value="{{ $watchFilter }}" placeholder="Lumen, 3">
                    <p class="help-block">Leave blank to watch every signaling group. Otherwise match a name, signaling group id, or the full trunk id.</p>
                </div>
                <div class="checkbox"><label><input type="hidden" name="settings[alertOnRecovery]" value="0"><input type="checkbox" name="settings[alertOnRecovery]" value="1" @if($alertOnRecovery) checked @endif> Email when a trunk recovers</label></div>
                <div class="checkbox"><label><input type="hidden" name="settings[alertOnDegraded]" value="0"><input type="checkbox" name="settings[alertOnDegraded]" value="1" @if($alertOnDegraded) checked @endif> Email when a trunk is draining or drained</label></div>
                <div class="checkbox"><label><input type="hidden" name="settings[alertOnStartup]" value="0"><input type="checkbox" name="settings[alertOnStartup]" value="1" @if($alertOnStartup) checked @endif> Email trunks that are already down on the first poll</label></div>
            </div>
        </div>

        <button type="submit" class="btn btn-primary">Save</button>
    </form>
</div>

<template id="sbc-template">
    <div class="sbc-card" style="border-top: 1px solid rgba(128,128,128,.25); padding-top: 12px; margin-top: 12px;">
        <div class="row">
            <div class="col-sm-6 form-group">
                <label>Label</label>
                <input class="form-control" type="text" name="settings[sbcs][__INDEX__][name]" value="" placeholder="Chicago">
            </div>
            <div class="col-sm-4 form-group">
                <label>Address</label>
                <input class="form-control" data-host type="text" name="settings[sbcs][__INDEX__][host]" value="" placeholder="sbc.example.com">
            </div>
            <div class="col-sm-2 form-group">
                <label>Port</label>
                <input class="form-control" type="number" min="1" max="65535" name="settings[sbcs][__INDEX__][port]" value="443">
            </div>
        </div>
        <div class="row">
            <div class="col-sm-4 form-group">
                <label>REST username</label>
                <input class="form-control" type="text" name="settings[sbcs][__INDEX__][username]" value="" autocomplete="off">
            </div>
            <div class="col-sm-4 form-group">
                <label>REST password</label>
                <input class="form-control" data-password type="password" name="settings[sbcs][__INDEX__][password]" value="" autocomplete="new-password">
            </div>
            <div class="col-sm-4 form-group">
                <label class="checkbox-inline" style="margin-top: 28px;">
                    <input type="hidden" name="settings[sbcs][__INDEX__][enabled]" value="0">
                    <input type="checkbox" name="settings[sbcs][__INDEX__][enabled]" value="1" checked> Enabled
                </label>
                <label class="checkbox-inline">
                    <input type="hidden" name="settings[sbcs][__INDEX__][tlsVerify]" value="0">
                    <input type="checkbox" name="settings[sbcs][__INDEX__][tlsVerify]" value="1"> Verify TLS
                </label>
            </div>
        </div>
        <input type="hidden" name="settings[sbcs][__INDEX__][id]" value="__ID__">
        <button type="button" class="btn btn-link remove-sbc">Remove</button>
    </div>
</template>

@include('RibbonTrunks::resources.views.sbc-script')
