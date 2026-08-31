package io.github.kkomaprogrammer.entryofflinemobile;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(EntryFilePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
