package app.sastakahan;

import android.content.Intent;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.PluginHandle;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ShareInPlugin.class);
        registerPlugin(ToolsPlugin.class);
        // Cold start from the Share sheet: keep the text until the web app asks for it.
        ShareInPlugin.setPending(ShareInPlugin.textFrom(getIntent()));
        super.onCreate(savedInstanceState);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        String text = ShareInPlugin.textFrom(intent);
        if (text == null) return;
        PluginHandle handle = getBridge().getPlugin("ShareIn");
        if (handle != null) ((ShareInPlugin) handle.getInstance()).deliver(text);
    }
}
