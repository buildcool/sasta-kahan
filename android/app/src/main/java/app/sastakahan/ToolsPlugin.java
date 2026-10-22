package app.sastakahan;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.webkit.CookieManager;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.common.moduleinstall.ModuleInstall;
import com.google.android.gms.common.moduleinstall.ModuleInstallRequest;
import com.google.mlkit.vision.barcode.common.Barcode;
import com.google.mlkit.vision.codescanner.GmsBarcodeScanner;
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions;
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning;

/**
 * Small native helpers for src/native.ts: open a product in the shop's own app,
 * scan a barcode, and log in to a shop inside the app (beta).
 */
@CapacitorPlugin(name = "Tools")
public class ToolsPlugin extends Plugin {

    /** Open a product link in the shop's app, where the user is logged in and sees their own coupons. */
    @PluginMethod
    public void openInApp(PluginCall call) {
        String url = call.getString("url");
        if (url == null) {
            call.reject("url required");
            return;
        }
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        String pkg = call.getString("package");
        if (pkg != null) intent.setPackage(pkg);
        JSObject ret = new JSObject();
        try {
            getContext().startActivity(intent);
            ret.put("opened", true);
        } catch (ActivityNotFoundException e) {
            ret.put("opened", false); // the shop's app isn't installed
        }
        call.resolve(ret);
    }

    /** Google's barcode scanner screen (Play services): no camera permission needed. */
    @PluginMethod
    public void scanBarcode(PluginCall call) {
        GmsBarcodeScannerOptions options = new GmsBarcodeScannerOptions.Builder()
            .setBarcodeFormats(Barcode.FORMAT_EAN_13, Barcode.FORMAT_EAN_8, Barcode.FORMAT_UPC_A, Barcode.FORMAT_UPC_E)
            .build();
        GmsBarcodeScanner scanner = GmsBarcodeScanning.getClient(getActivity(), options);
        scanner
            .startScan()
            .addOnSuccessListener(barcode -> {
                JSObject ret = new JSObject();
                ret.put("code", barcode.getRawValue());
                call.resolve(ret);
            })
            .addOnCanceledListener(() -> call.reject("canceled", "CANCELED"))
            .addOnFailureListener(e -> {
                // First use on a sideloaded install: the scanner module isn't on the phone yet. Ask Play services for it.
                ModuleInstall.getClient(getContext()).installModules(ModuleInstallRequest.newBuilder().addApi(scanner).build());
                call.reject(e.getMessage() == null ? "scanner unavailable" : e.getMessage(), "UNAVAILABLE");
            });
    }

    /** The shop's login page in an in-app browser; its cookies are the ones the app's price checks send. */
    @PluginMethod
    public void openLogin(PluginCall call) {
        String url = call.getString("url");
        if (url == null) {
            call.reject("url required");
            return;
        }
        Intent intent = new Intent(getContext(), LoginActivity.class);
        intent.putExtra("url", url);
        intent.putExtra("title", call.getString("title", ""));
        intent.putExtra("userAgent", call.getString("userAgent"));
        startActivityForResult(call, intent, "loginClosed");
    }

    @ActivityCallback
    private void loginClosed(PluginCall call, ActivityResult result) {
        if (call != null) call.resolve();
    }

    /** Log out of a shop: expire its cookies, both host-only and domain-wide (".amazon.in") ones. */
    @PluginMethod
    public void clearCookies(PluginCall call) {
        String url = call.getString("url");
        String domain = call.getString("domain");
        if (url == null) {
            call.reject("url required");
            return;
        }
        CookieManager cookies = CookieManager.getInstance();
        String all = cookies.getCookie(url);
        if (all != null) {
            for (String part : all.split(";")) {
                String name = part.split("=", 2)[0].trim();
                if (name.isEmpty()) continue;
                cookies.setCookie(url, name + "=; Max-Age=0; Path=/");
                if (domain != null) cookies.setCookie(url, name + "=; Max-Age=0; Path=/; Domain=" + domain);
            }
        }
        cookies.flush();
        call.resolve();
    }
}
