<div class="sbc-card" style="border-top: 1px solid rgba(128,128,128,.25); padding-top: 12px; margin-top: 12px;">
    <div class="row">
        <div class="col-sm-6 form-group">
            <label>Label</label>
            <input class="form-control" type="text" name="settings[sbcs][{{ $index }}][name]" value="{{ $sbc['name'] }}" placeholder="Chicago">
        </div>
        <div class="col-sm-4 form-group">
            <label>Address</label>
            <input class="form-control" data-host type="text" name="settings[sbcs][{{ $index }}][host]" value="{{ $sbc['host'] }}" placeholder="sbc.example.com">
        </div>
        <div class="col-sm-2 form-group">
            <label>Port</label>
            <input class="form-control" type="number" min="1" max="65535" name="settings[sbcs][{{ $index }}][port]" value="{{ $sbc['port'] }}">
        </div>
    </div>
    <div class="row">
        <div class="col-sm-4 form-group">
            <label>REST username</label>
            <input class="form-control" type="text" name="settings[sbcs][{{ $index }}][username]" value="{{ $sbc['username'] }}" autocomplete="off">
        </div>
        <div class="col-sm-4 form-group">
            <label>REST password</label>
            <input class="form-control" data-password type="password" name="settings[sbcs][{{ $index }}][password]" value="{{ $sbc['password'] }}" autocomplete="new-password">
        </div>
        <div class="col-sm-4 form-group">
            <label class="checkbox-inline" style="margin-top: 28px;">
                <input type="hidden" name="settings[sbcs][{{ $index }}][enabled]" value="0">
                <input type="checkbox" name="settings[sbcs][{{ $index }}][enabled]" value="1" @if($sbc['enabled']) checked @endif> Enabled
            </label>
            <label class="checkbox-inline">
                <input type="hidden" name="settings[sbcs][{{ $index }}][tlsVerify]" value="0">
                <input type="checkbox" name="settings[sbcs][{{ $index }}][tlsVerify]" value="1" @if($sbc['tlsVerify']) checked @endif> Verify TLS
            </label>
        </div>
    </div>
    <input type="hidden" name="settings[sbcs][{{ $index }}][id]" value="{{ $sbc['id'] }}">
    <button type="button" class="btn btn-link remove-sbc">Remove</button>
</div>
