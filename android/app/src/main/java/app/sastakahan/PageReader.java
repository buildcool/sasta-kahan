package app.sastakahan;

import android.annotation.SuppressLint;
import android.annotation.TargetApi;
import android.app.Activity;
import android.graphics.Bitmap;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import java.util.HashSet;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Opens a shop's page in a hidden WebView — a normal browser page, as if the user opened the
 * site — and reports back what src/core/search.ts needs: the page's own search responses
 * (`capture`), or the answer to one request run inside the page (`run`). For sites that only
 * answer real browsers (Zepto, Instamart). One page per call; the WebView is destroyed after.
 */
class PageReader {

    /** JavaScript name of the channel the page reports through. */
    private static final String BRIDGE = "SKReader";
    /** Enough for a few search responses; more is never needed. */
    private static final int MAX_BYTES = 6_000_000;

    /**
     * Copies responses whose URL matches CAPTURE (a JS string) to the app. Runs before the
     * page's own scripts, and only wraps fetch/XMLHttpRequest — it doesn't change requests.
     */
    private static final String HOOK =
        "(function(){if(window.__skHook)return;window.__skHook=1;var re=new RegExp(CAPTURE);" +
        "function post(u,s,t){try{" + BRIDGE + ".postMessage(JSON.stringify({url:String(u),status:s,body:t}))}catch(e){}}" +
        "var f=window.fetch;if(f){window.fetch=function(i){var u=typeof i==='string'?i:(i&&i.url)||String(i);" +
        "var p=f.apply(this,arguments);if(re.test(u))p.then(function(r){r.clone().text().then(function(t){post(u,r.status,t)},function(){})},function(){});return p}}" +
        "var X=XMLHttpRequest.prototype,op=X.open,sd=X.send;" +
        "X.open=function(m,u){this.__skUrl=String(u);return op.apply(this,arguments)};" +
        "X.send=function(){var x=this;if(re.test(x.__skUrl||''))x.addEventListener('load',function(){try{" +
        "var t=x.responseType===''||x.responseType==='text'?x.responseText:x.responseType==='json'?JSON.stringify(x.response):null;" +
        "if(t!=null)post(x.__skUrl,x.status,t)}catch(e){}});return sd.apply(this,arguments)};})();";

    private final Activity activity;
    private final ViewGroup parent;
    private final PluginCall call;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final JSONArray captures = new JSONArray();
    private int bytes = 0;
    private WebView web;
    private JSObject run;
    private boolean runPending;
    private boolean done;

    PageReader(Activity activity, ViewGroup parent, PluginCall call) {
        this.activity = activity;
        this.parent = parent;
        this.call = call;
    }

    /** Must be called on the UI thread. */
    @SuppressLint("SetJavaScriptEnabled")
    void start() {
        String url = call.getString("url");
        String capture = call.getString("capture");
        run = call.getObject("run");
        int timeout = call.getInt("timeoutMs", 25000);

        Set<String> origins = new HashSet<>();
        JSArray originList = call.getArray("origins", new JSArray());
        for (int i = 0; i < originList.length(); i++) origins.add(originList.optString(i));
        if (origins.isEmpty()) origins.add("*");

        // Cookies first: the delivery location the site reads when the page loads.
        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        JSArray cookieList = call.getArray("cookies", new JSArray());
        for (int i = 0; i < cookieList.length(); i++) {
            JSONObject c = cookieList.optJSONObject(i);
            if (c != null) cookies.setCookie(c.optString("url"), c.optString("value"));
        }
        cookies.flush();

        web = new WebView(activity);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        // Prices only: skip images to save the user's data.
        s.setLoadsImagesAutomatically(false);
        s.setBlockNetworkImage(true);
        s.setMediaPlaybackRequiresUserGesture(true);
        cookies.setAcceptThirdPartyCookies(web, true);

        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            // Only the shop's own origin can post to us.
            WebViewCompat.addWebMessageListener(web, BRIDGE, origins, (view, message, sourceOrigin, isMainFrame, reply) -> onMessage(message.getData()));
        } else {
            web.addJavascriptInterface(new Object() {
                @JavascriptInterface
                public void postMessage(String data) {
                    main.post(() -> onMessage(data));
                }
            }, BRIDGE);
        }

        final String hook = capture == null ? null : HOOK.replace("CAPTURE", JSONObject.quote(capture));
        final boolean atDocumentStart = hook != null && WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT);
        if (atDocumentStart) WebViewCompat.addDocumentStartJavaScript(web, hook, origins);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String pageUrl, Bitmap favicon) {
                if (hook != null && !atDocumentStart) view.evaluateJavascript(hook, null);
            }

            @Override
            public void onPageFinished(WebView view, String pageUrl) {
                // A bot check reloads the page when it's done; each load gets one try.
                if (run != null) main.postDelayed(PageReader.this::runInPage, 1500);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                // Stay on the web: never hand off to the shop's app or the Play Store.
                String scheme = request.getUrl().getScheme();
                return scheme == null || !(scheme.equals("http") || scheme.equals("https"));
            }

            @Override
            @TargetApi(Build.VERSION_CODES.O)
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                // The page crashed or was killed for memory: report what we have, don't take the app down.
                if (!done) {
                    done = true;
                    main.removeCallbacksAndMessages(null);
                    resolve("crash", null, null);
                }
                close(view);
                return true;
            }
        });

        // Behind the app's own WebView: rendered like a visible page, but the user never sees it.
        parent.addView(web, 0, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        web.loadUrl(url);
        main.postDelayed(() -> finish("timeout"), timeout);
    }

    /** Run the site's search request inside the loaded page (same origin, the page's cookies). */
    private void runInPage() {
        if (done || web == null || runPending || run == null) return;
        runPending = true;
        JSObject headers = run.getJSObject("headers");
        if (headers == null) headers = new JSObject();
        String body = run.getString("body");
        String js =
            "(function(){var u=" + JSONObject.quote(run.getString("url", "")) + ";" +
            "var o={method:" + JSONObject.quote(run.getString("method", "GET")) + ",headers:" + headers.toString() + ",credentials:'include'};" +
            (body == null ? "" : "o.body=" + JSONObject.quote(body) + ";") +
            "fetch(u,o).then(function(r){return r.text().then(function(t){" + BRIDGE + ".postMessage(JSON.stringify({url:u,status:r.status,body:t,run:true}))})})" +
            ".catch(function(e){" + BRIDGE + ".postMessage(JSON.stringify({url:u,status:0,body:String(e),run:true}))})})()";
        web.evaluateJavascript(js, null);
    }

    private void onMessage(String data) {
        if (done || data == null) return;
        try {
            JSONObject m = new JSONObject(data);
            String body = m.optString("body", "");
            int status = m.optInt("status");
            if (bytes + body.length() <= MAX_BYTES) {
                bytes += body.length();
                JSObject c = new JSObject();
                c.put("url", m.optString("url"));
                c.put("status", status);
                c.put("body", body);
                captures.put(c);
            }
            if (m.optBoolean("run")) {
                runPending = false;
                if (status == 200) finish("done");
                // Still behind the bot check: try again shortly (or on the next page load).
                else main.postDelayed(this::runInPage, 3000);
            } else if (status == 200) {
                // The page's own search answered; a moment more catches a second batch.
                main.postDelayed(() -> finish("done"), 800);
            }
        } catch (JSONException ignored) {
            // not one of ours
        }
    }

    private void finish(String reason) {
        if (done) return;
        done = true;
        main.removeCallbacksAndMessages(null);
        final WebView w = web;
        if (w == null) {
            resolve(reason, null, null);
            return;
        }
        // Title and the start of the text tell "pick your location" or a block page apart.
        final boolean[] answered = { false };
        final Runnable giveUp = () -> {
            if (answered[0]) return;
            answered[0] = true;
            resolve(reason, null, null);
            close(w);
        };
        main.postDelayed(giveUp, 1500);
        w.evaluateJavascript(
            "(function(){try{return JSON.stringify({t:document.title,x:(document.body&&document.body.innerText||'').slice(0,1500)})}catch(e){return null}})()",
            value -> {
                if (answered[0]) return;
                answered[0] = true;
                main.removeCallbacks(giveUp);
                String title = null;
                String text = null;
                try {
                    // The result arrives JSON-encoded: a string literal holding our JSON.
                    if (value != null && !value.equals("null")) {
                        JSONObject o = new JSONObject(new JSONArray("[" + value + "]").getString(0));
                        title = o.optString("t");
                        text = o.optString("x");
                    }
                } catch (JSONException ignored) {
                    // no text, that's fine
                }
                resolve(reason, title, text);
                close(w);
            }
        );
    }

    private void resolve(String reason, String title, String text) {
        JSObject ret = new JSObject();
        ret.put("captures", captures);
        ret.put("reason", reason);
        if (title != null) ret.put("title", title);
        if (text != null) ret.put("text", text);
        call.resolve(ret);
    }

    private void close(WebView w) {
        try {
            parent.removeView(w);
            w.stopLoading();
            w.destroy();
        } catch (RuntimeException ignored) {
            // already gone
        }
        if (w == web) web = null;
    }
}
