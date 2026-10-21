package app.sastakahan;

import android.content.Intent;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Receives text shared from other apps (Amazon, Flipkart, Chrome...) via
 * Android's Share sheet and hands it to the web app (src/native.ts).
 */
@CapacitorPlugin(name = "ShareIn")
public class ShareInPlugin extends Plugin {

    private static String pending;

    /** Called by MainActivity for both cold start and already-running app. */
    static String textFrom(Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) return null;
        String text = intent.getStringExtra(Intent.EXTRA_TEXT);
        String subject = intent.getStringExtra(Intent.EXTRA_SUBJECT);
        if (text == null) return subject;
        // Some apps put the product name in the subject and only a link in the text.
        if (subject != null && !text.contains(subject)) return subject + " " + text;
        return text;
    }

    static void setPending(String text) {
        pending = text;
    }

    void deliver(String text) {
        JSObject data = new JSObject();
        data.put("text", text);
        notifyListeners("shared", data);
    }

    @PluginMethod
    public void getShared(PluginCall call) {
        JSObject ret = new JSObject();
        if (pending != null) {
            ret.put("text", pending);
            pending = null;
        }
        call.resolve(ret);
    }
}
