package io.github.kkomaprogrammer.entryofflinemobile;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.OutputStream;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

@CapacitorPlugin(name = "EntryFile")
public class EntryFilePlugin extends Plugin {
    private final Map<String, OutputStream> streams = new ConcurrentHashMap<>();

    @PluginMethod
    public void beginSave(PluginCall call) {
        String filename = call.getString("filename", "Entry.ent");
        String mimeType = call.getString("mimeType", "application/octet-stream");
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(mimeType);
        intent.putExtra(Intent.EXTRA_TITLE, filename);
        startActivityForResult(call, intent, "saveLocationSelected");
    }

    @ActivityCallback
    private void saveLocationSelected(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            call.reject("저장이 취소되었습니다.");
            return;
        }
        Uri uri = result.getData().getData();
        if (uri == null) {
            call.reject("저장 위치를 열 수 없습니다.");
            return;
        }
        try {
            OutputStream stream = getContext().getContentResolver().openOutputStream(uri, "w");
            if (stream == null) {
                call.reject("저장 파일을 만들 수 없습니다.");
                return;
            }
            String token = UUID.randomUUID().toString();
            streams.put(token, stream);
            JSObject response = new JSObject();
            response.put("token", token);
            call.resolve(response);
        } catch (Exception error) {
            call.reject("저장 파일을 열 수 없습니다.", error);
        }
    }

    @PluginMethod
    public void appendSave(PluginCall call) {
        String token = call.getString("token");
        String data = call.getString("data");
        OutputStream stream = streams.get(token);
        if (stream == null || data == null) {
            call.reject("유효하지 않은 저장 작업입니다.");
            return;
        }
        try {
            stream.write(Base64.decode(data, Base64.DEFAULT));
            call.resolve();
        } catch (Exception error) {
            closeStream(token);
            call.reject("파일을 쓰지 못했습니다.", error);
        }
    }

    @PluginMethod
    public void finishSave(PluginCall call) {
        String token = call.getString("token");
        OutputStream stream = streams.remove(token);
        if (stream == null) {
            call.reject("유효하지 않은 저장 작업입니다.");
            return;
        }
        try {
            stream.flush();
            stream.close();
            call.resolve();
        } catch (Exception error) {
            call.reject("파일 저장을 마치지 못했습니다.", error);
        }
    }

    @PluginMethod
    public void abortSave(PluginCall call) {
        closeStream(call.getString("token"));
        call.resolve();
    }

    private void closeStream(String token) {
        if (token == null) return;
        OutputStream stream = streams.remove(token);
        if (stream == null) return;
        try { stream.close(); } catch (Exception ignored) { }
    }

    @Override
    protected void handleOnDestroy() {
        for (String token : streams.keySet()) closeStream(token);
        super.handleOnDestroy();
    }
}
