package cn.weishuxieyi.mobile;

import android.app.*;
import android.content.*;
import android.content.pm.ActivityInfo;
import android.graphics.Color;
import android.net.Uri;
import android.net.http.SslError;
import android.os.*;
import android.view.*;
import android.webkit.*;
import android.widget.*;

/** A full-screen HTTPS game client; all art/audio/font resources are in the signed APK. */
public final class MainActivity extends Activity {
    private WebView web;
    private LauncherView launcher;
    private ServerRegistry registry;
    private ProgressBar progress;
    private BundledResources bundled;
    private ValueCallback<Uri[]> fileCallback;
    private boolean game=false,errorShown=false,launcherVisible=true;
    @Override public void onCreate(Bundle saved){
        super.onCreate(saved);getWindow().setStatusBarColor(Color.rgb(12,15,14));getWindow().setNavigationBarColor(Color.rgb(12,15,14));
        try{bundled=new BundledResources(getAssets());registry=new ServerRegistry(getAssets());}catch(Exception e){new AlertDialog.Builder(this).setTitle("内置资源无法读取").setMessage("请重新安装完整APK，当前安装文件可能不完整。").setPositiveButton("关闭",(d,w)->finish()).setCancelable(false).show();return;}
        FrameLayout root=new FrameLayout(this);root.setBackgroundColor(Color.rgb(12,15,14));web=new WebView(this);web.setBackgroundColor(Color.rgb(12,15,14));root.addView(web,new FrameLayout.LayoutParams(-1,-1));
        progress=new ProgressBar(this,null,android.R.attr.progressBarStyleHorizontal);root.addView(progress,new FrameLayout.LayoutParams(-1,6,Gravity.TOP));setContentView(root);
        launcher=new LauncherView(this,registry.servers,new LauncherView.Actions(){public void enter(ServerRegistry.Server server){if(launcherVisible)enterGame(server.url);}public void updates(){external(Uri.parse("https://pan.quark.cn/s/c078652ad1fd"));}});root.addView(launcher,new FrameLayout.LayoutParams(-1,-1));
        root.setOnApplyWindowInsetsListener((view,insets)->{int left=insets.getSystemWindowInsetLeft(),top=insets.getSystemWindowInsetTop(),right=insets.getSystemWindowInsetRight(),bottom=insets.getSystemWindowInsetBottom();if(Build.VERSION.SDK_INT>=28&&insets.getDisplayCutout()!=null){left=Math.max(left,insets.getDisplayCutout().getSafeInsetLeft());top=Math.max(top,insets.getDisplayCutout().getSafeInsetTop());right=Math.max(right,insets.getDisplayCutout().getSafeInsetRight());bottom=Math.max(bottom,insets.getDisplayCutout().getSafeInsetBottom());}view.setPadding(left,top,right,bottom);return insets;});
        WebSettings settings=web.getSettings();settings.setJavaScriptEnabled(true);settings.setDomStorageEnabled(true);settings.setDatabaseEnabled(true);settings.setMediaPlaybackRequiresUserGesture(false);settings.setAllowFileAccess(false);settings.setAllowContentAccess(true);settings.setAllowFileAccessFromFileURLs(false);settings.setAllowUniversalAccessFromFileURLs(false);settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);settings.setSupportMultipleWindows(true);settings.setJavaScriptCanOpenWindowsAutomatically(false);settings.setUserAgentString(settings.getUserAgentString()+" SPAndroid/1.0.2 BundledAssets/3");
        CookieManager.getInstance().setAcceptCookie(true);CookieManager.getInstance().setAcceptThirdPartyCookies(web,false);WebView.setWebContentsDebuggingEnabled(false);
        ServiceWorkerController.getInstance().getServiceWorkerWebSettings().setAllowFileAccess(false);
        ServiceWorkerController.getInstance().setServiceWorkerClient(new ServiceWorkerClient(){@Override public WebResourceResponse shouldInterceptRequest(WebResourceRequest request){return bundled.intercept(request);}});
        web.setWebViewClient(new WebViewClient(){
            @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){if(internal(request.getUrl())){if(request.isForMainFrame())configureBridge(request.getUrl());return false;}if(request.hasGesture())external(request.getUrl());return true;}
            @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request){return bundled.intercept(request);}
            @Override public void onPageStarted(WebView view,String url,android.graphics.Bitmap icon){errorShown=false;bundled.setPage(url);game=!launcherVisible&&internal(Uri.parse(url));setRequestedOrientation(game?ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE:ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);immersive();progress.setVisibility(launcherVisible?View.GONE:View.VISIBLE);}
            @Override public void onPageFinished(WebView view,String url){progress.setVisibility(View.GONE);CookieManager.getInstance().flush();}
            @Override public void onReceivedSslError(WebView view,SslErrorHandler handler,SslError error){handler.cancel();showError("网站证书校验失败，请确认手机时间和网络后重试。");}
            @Override public void onReceivedError(WebView view,WebResourceRequest request,WebResourceError error){if(request.isForMainFrame())showError("暂时无法连接服务器，请检查网络后重试。内置素材仍保留。");}
            @Override public boolean onRenderProcessGone(WebView view,RenderProcessGoneDetail detail){runOnUiThread(()->{view.destroy();new AlertDialog.Builder(MainActivity.this).setTitle("游戏画面已停止").setMessage("请关闭并重新打开客户端，内置资源和登录数据保留。").setPositiveButton("关闭",(d,w)->finish()).setCancelable(false).show();});return true;}
        });
        web.setWebChromeClient(new WebChromeClient(){
            @Override public void onProgressChanged(WebView view,int value){progress.setProgress(value);}
            @Override public boolean onShowFileChooser(WebView view,ValueCallback<Uri[]> callback,FileChooserParams params){if(fileCallback!=null)fileCallback.onReceiveValue(null);fileCallback=callback;Intent pick=new Intent(Intent.ACTION_OPEN_DOCUMENT);pick.addCategory(Intent.CATEGORY_OPENABLE);pick.setType("*/*");pick.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);try{startActivityForResult(pick,71);}catch(ActivityNotFoundException e){fileCallback.onReceiveValue(null);fileCallback=null;Toast.makeText(MainActivity.this,"未找到系统文件选择器",Toast.LENGTH_LONG).show();}return true;}
            @Override public boolean onCreateWindow(WebView view,boolean dialog,boolean userGesture,Message resultMsg){if(!userGesture)return false;WebView popup=new WebView(MainActivity.this);popup.setWebViewClient(new WebViewClient(){@Override public boolean shouldOverrideUrlLoading(WebView v,WebResourceRequest request){external(request.getUrl());v.destroy();return true;}@Override public void onPageStarted(WebView v,String url,android.graphics.Bitmap icon){if(!"about:blank".equals(url)){external(Uri.parse(url));v.stopLoading();v.destroy();}}});((WebView.WebViewTransport)resultMsg.obj).setWebView(popup);resultMsg.sendToTarget();return true;}
            @Override public boolean onJsAlert(WebView view,String url,String message,JsResult result){new AlertDialog.Builder(MainActivity.this).setMessage(message).setPositiveButton("确定",(d,w)->result.confirm()).setOnCancelListener(d->result.cancel()).show();return true;}
            @Override public boolean onJsConfirm(WebView view,String url,String message,JsResult result){new AlertDialog.Builder(MainActivity.this).setMessage(message).setPositiveButton("确定",(d,w)->result.confirm()).setNegativeButton("取消",(d,w)->result.cancel()).setOnCancelListener(d->result.cancel()).show();return true;}
        });
        String resume=saved==null?null:saved.getString("sp.gameUrl");
        if(resume!=null&&internal(Uri.parse(resume)))enterGame(resume);else showLauncher();
    }
    private boolean internal(Uri uri){return registry!=null&&registry.contains(uri);}
    private void configureBridge(Uri uri){if(BundledResources.trusted(uri))web.addJavascriptInterface(bundled,"SPAndroidResources");else web.removeJavascriptInterface("SPAndroidResources");}
    private void enterGame(String url){launcherVisible=false;launcher.setVisibility(View.GONE);web.setVisibility(View.VISIBLE);configureBridge(Uri.parse(url));web.loadUrl(url);}
    private void showLauncher(){launcherVisible=true;game=false;errorShown=false;web.stopLoading();web.removeJavascriptInterface("SPAndroidResources");web.loadUrl("about:blank");web.setVisibility(View.GONE);progress.setVisibility(View.GONE);launcher.setVisibility(View.VISIBLE);setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);immersive();}
    private void external(Uri uri){if(!"https".equalsIgnoreCase(uri.getScheme())&&!"http".equalsIgnoreCase(uri.getScheme()))return;try{startActivity(new Intent(Intent.ACTION_VIEW,uri).addCategory(Intent.CATEGORY_BROWSABLE));}catch(ActivityNotFoundException e){Toast.makeText(this,"没有可打开链接的浏览器",Toast.LENGTH_LONG).show();}}
    private void showError(String message){runOnUiThread(()->{progress.setVisibility(View.GONE);if(launcherVisible||errorShown||isFinishing())return;errorShown=true;new AlertDialog.Builder(this).setTitle("连接暂不可用").setMessage(message).setPositiveButton("重试",(d,w)->web.reload()).setNegativeButton("返回选服",(d,w)->showLauncher()).show();});}
    private void immersive(){getWindow().getDecorView().setSystemUiVisibility(game?View.SYSTEM_UI_FLAG_FULLSCREEN|View.SYSTEM_UI_FLAG_HIDE_NAVIGATION|View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY:0);if(game)getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);}
    @Override public void onWindowFocusChanged(boolean focus){super.onWindowFocusChanged(focus);if(focus&&web!=null)immersive();}
    @Override protected void onActivityResult(int request,int result,Intent data){super.onActivityResult(request,result,data);if(request==71&&fileCallback!=null){Uri[] selected=null;if(result==RESULT_OK&&data!=null&&data.getData()!=null&&"content".equals(data.getData().getScheme()))selected=new Uri[]{data.getData()};fileCallback.onReceiveValue(selected);fileCallback=null;}}
    @Override public void onBackPressed(){if(web==null){super.onBackPressed();return;}if(!launcherVisible)new AlertDialog.Builder(this).setTitle("返回选服大厅？").setMessage("当前页面会关闭，进行中的对局可通过重连恢复。").setPositiveButton("返回选服",(d,w)->showLauncher()).setNegativeButton("继续游戏",null).show();else moveTaskToBack(true);}
    @Override protected void onSaveInstanceState(Bundle out){super.onSaveInstanceState(out);if(web!=null&&!launcherVisible){String url=web.getUrl();if(url!=null&&internal(Uri.parse(url)))out.putString("sp.gameUrl",url);}}
    @Override protected void onPause(){super.onPause();CookieManager.getInstance().flush();}
    @Override protected void onDestroy(){if(fileCallback!=null)fileCallback.onReceiveValue(null);if(web!=null){web.removeJavascriptInterface("SPAndroidResources");web.destroy();}super.onDestroy();}
}
