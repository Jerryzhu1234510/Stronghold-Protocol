// Executes the production resource interceptor on the JVM with small Android API
// adapters. This checks native decisions and bytes, not Android WebView rendering.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const manifest=JSON.parse(await fs.readFile(root+'/export/resource-manifest.json','utf8'));
const servers=JSON.parse(await fs.readFile(root+'/android/assets/servers.json','utf8'));
const base=Object.entries(manifest.entries).filter(([u])=>!manifest.extras[u]);
const choose=(items,ext)=>items.filter(([u])=>u.toLowerCase().endsWith(ext)).sort((a,b)=>a[1].bytes-b[1].bytes)[0];
const png=choose(base,'.png'),audio=choose(base,'.mp3'),obj=choose(base,'.obj'),json=choose(base,'.json'),css=['/fonts/fonts.css',manifest.entries['/fonts/fonts.css']];
assert.ok(png&&audio&&obj&&json&&css[1]);
const entries=Object.fromEntries([png,audio,obj,json,css]);
const bundle={version:1,entries,extras:Object.fromEntries([obj,json,css]),extraBuilds:['8edb310885ef-1']};
const cdn='https://assets.weishuxieyi.icu/pilot/content/'+png[1].hash+'.png';
const snapshot={version:1,entries:{[png[0]]:{...png[1],cdn},[audio[0]]:audio[1]},aliases:{'/media/test-audio':audio[0]}};
const changed=structuredClone(snapshot);changed.entries[png[0]].hash='0'.repeat(64);
function literal(v){if(v===null)return 'null';if(Array.isArray(v))return 'new JSONArray()'+v.map(x=>'.put('+literal(x)+')').join('');if(typeof v==='object')return 'new JSONObject()'+Object.entries(v).map(([k,x])=>'.put('+JSON.stringify(k)+','+literal(x)+')').join('');return typeof v==='number'?v+'L':JSON.stringify(v);}
const qa=root+'/test-output/native-101';await fs.mkdir(qa,{recursive:true});
const sources={
'org/json/JSONException.java':`package org.json; public class JSONException extends Exception {public JSONException(String s){super(s);}}`,
'org/json/JSONObject.java':`package org.json; import java.util.*;
public class JSONObject {
 public static final Map<String,JSONObject> fixtures=new HashMap<>(); private final Map<String,Object> values=new LinkedHashMap<>();
 public JSONObject(){} public JSONObject(String s)throws JSONException{JSONObject v=fixtures.get(s);if(v==null)throw new JSONException("Unknown JSON fixture");values.putAll(v.values);}
 public JSONObject put(String k,Object v){values.put(k,v);return this;} public boolean has(String k){return values.containsKey(k);} public int length(){return values.size();} public Iterator<String> keys(){return values.keySet().iterator();}
 public JSONObject getJSONObject(String k)throws JSONException{Object v=values.get(k);if(!(v instanceof JSONObject))throw new JSONException(k);return (JSONObject)v;}
 public JSONObject optJSONObject(String k){return values.get(k) instanceof JSONObject?(JSONObject)values.get(k):null;}
 public JSONArray getJSONArray(String k)throws JSONException{Object v=values.get(k);if(!(v instanceof JSONArray))throw new JSONException(k);return (JSONArray)v;}
 public JSONArray optJSONArray(String k){return values.get(k) instanceof JSONArray?(JSONArray)values.get(k):null;}
 public String getString(String k)throws JSONException{Object v=values.get(k);if(!(v instanceof String))throw new JSONException(k);return (String)v;}
 public String optString(String k){return optString(k,"");} public String optString(String k,String d){Object v=values.get(k);return v instanceof String?(String)v:d;}
 public long getLong(String k)throws JSONException{Object v=values.get(k);if(!(v instanceof Number))throw new JSONException(k);return ((Number)v).longValue();}
 public long optLong(String k){Object v=values.get(k);return v instanceof Number?((Number)v).longValue():0;}
 public int optInt(String k){return (int)optLong(k);} public String toString(){String key="generated-"+fixtures.size();fixtures.put(key,this);return key;}
}`,
'org/json/JSONArray.java':`package org.json; import java.util.*; public class JSONArray {private final List<Object> values=new ArrayList<>();public JSONArray put(Object v){values.add(v);return this;}public int length(){return values.size();}public String getString(int i){return (String)values.get(i);}public JSONObject getJSONObject(int i){return (JSONObject)values.get(i);}}`,
'android/net/Uri.java':`package android.net; import java.net.*; import java.nio.charset.StandardCharsets;
public final class Uri {private final URI uri;private Uri(String s){uri=URI.create(s);}public static Uri parse(String s){return new Uri(s);}public String toString(){return uri.toString();}public String getScheme(){return uri.getScheme();}public String getHost(){return uri.getHost();}public String getUserInfo(){return uri.getUserInfo();}public String getFragment(){return uri.getFragment();}public int getPort(){return uri.getPort();}public String getEncodedPath(){return uri.getRawPath();}public static String decode(String s){return URLDecoder.decode(s.replace("+","%2B"),StandardCharsets.UTF_8);}public static String encode(String s){return URLEncoder.encode(s,StandardCharsets.UTF_8).replace("+","%20").replace("%7E","~");}}`,
'android/content/res/AssetManager.java':`package android.content.res; import java.io.*;import java.util.zip.*;public class AssetManager {public static final int ACCESS_STREAMING=2;private final ZipFile zip;public AssetManager(String apk)throws Exception{zip=new ZipFile(apk);}public InputStream open(String name)throws IOException{if(name.equals("pack/manifest.json"))return new ByteArrayInputStream("bundle".getBytes());if(name.equals("servers.json"))return new ByteArrayInputStream("servers".getBytes());ZipEntry entry=zip.getEntry("assets/"+name);if(entry==null)throw new FileNotFoundException(name);return zip.getInputStream(entry);}public InputStream open(String name,int mode)throws IOException{return open(name);}}`,
'android/webkit/JavascriptInterface.java':`package android.webkit; public @interface JavascriptInterface {}`,
'android/webkit/WebResourceRequest.java':`package android.webkit; import android.net.Uri;import java.util.Map;public interface WebResourceRequest{Uri getUrl();String getMethod();Map<String,String> getRequestHeaders();}`,
'android/webkit/WebResourceResponse.java':`package android.webkit;import java.io.*;import java.util.*;public class WebResourceResponse{public final String mime,encoding;public final int status;public final Map<String,String> headers;public final InputStream body;public WebResourceResponse(String m,String e,int s,String reason,Map<String,String> h,InputStream b){mime=m;encoding=e;status=s;headers=h;body=b;}}`,
'NativeTest.java':`import android.content.res.AssetManager;import android.net.Uri;import android.webkit.*;import cn.weishuxieyi.mobile.*;import org.json.*;import java.io.*;import java.net.*;import java.security.*;import java.util.*;import java.util.concurrent.*;
public final class NativeTest {
 static final String ORIGIN="https://weishuxieyiwangye.cn:8443",BUILD="8edb310885ef-1",PNG=${JSON.stringify(png[0])},AUDIO=${JSON.stringify(audio[0])},OBJ=${JSON.stringify(obj[0])},JSONFILE=${JSON.stringify(json[0])};static int fetches=0;static AssetManager assets;
 static void require(boolean value,String message){if(!value)throw new AssertionError(message);}
 static WebResourceRequest request(String url,String range,String method){return new WebResourceRequest(){public Uri getUrl(){return Uri.parse(url);}public String getMethod(){return method;}public Map<String,String> getRequestHeaders(){return range==null?Collections.emptyMap():Collections.singletonMap("Range",range);}};}
 static WebResourceResponse get(BundledResources lib,String p,String range){return lib.intercept(request(ORIGIN+"/_build/"+BUILD+p,range,"GET"));}
 static byte[] bytes(WebResourceResponse response)throws Exception{require(response!=null,"expected local response");try(InputStream in=response.body){return in.readAllBytes();}}
 static byte[] original(String url)throws Exception{try(InputStream in=assets.open("pack/"+Uri.decode(url.substring(1)))){return in.readAllBytes();}}
 public static void main(String[] args)throws Exception{
  JSONObject.fixtures.put("bundle",${literal(bundle)});JSONObject.fixtures.put("servers",${literal(servers)});JSONObject.fixtures.put("server",${literal(snapshot)});JSONObject.fixtures.put("changed",${literal(changed)});
  URL.setURLStreamHandlerFactory(protocol->!protocol.equals("https")?null:new URLStreamHandler(){protected URLConnection openConnection(URL url){return new HttpURLConnection(url){public void connect(){}public void disconnect(){}public boolean usingProxy(){return false;}public int getResponseCode(){fetches++;return 200;}public InputStream getInputStream(){return new ByteArrayInputStream((url.getPath().contains("/changed/")?"changed":"server").getBytes());}};}});
  assets=new AssetManager(args[0]);BundledResources lib=new BundledResources(assets);JSONObject bridge=new JSONObject(lib.getManifest());require(bridge.getJSONArray("entries").length()==1,"audio/extras must not enlarge the core gate");require(bridge.getLong("files")==5,"bundle files");
  ExecutorService pool=Executors.newFixedThreadPool(4);List<Future<byte[]>> pending=new ArrayList<>();for(int i=0;i<4;i++)pending.add(pool.submit(()->bytes(get(lib,PNG,null))));for(Future<byte[]> f:pending)require(Arrays.equals(f.get(),original(PNG)),"concurrent first local image");pool.shutdown();require(fetches==1,"first asset must load/deduplicate manifest before fallback");
  require(Arrays.equals(bytes(get(lib,PNG.toUpperCase(Locale.ROOT).replace("/ASSETS/","/assets/"),null)),original(PNG)),"Windows case alias");
  require(Arrays.equals(bytes(get(lib,OBJ,null)),original(OBJ)),"model extra");require(get(lib,OBJ,null).mime.equals("text/plain"),"OBJ MIME");require(get(lib,JSONFILE,null).mime.equals("application/json"),"JSON MIME");require(get(lib,"/fonts/fonts.css",null).mime.equals("text/css"),"font CSS MIME");
  WebResourceResponse part=get(lib,AUDIO,"bytes=2-8");require(part.status==206,"audio range status");require(Arrays.equals(bytes(part),Arrays.copyOfRange(original(AUDIO),2,9)),"audio partial bytes");
  WebResourceResponse suffix=get(lib,AUDIO,"bytes=-3");byte[] all=original(AUDIO);require(Arrays.equals(bytes(suffix),Arrays.copyOfRange(all,all.length-3,all.length)),"suffix bytes");require(get(lib,AUDIO,"bytes=999999999-").status==416,"invalid range");
  lib.setPage(ORIGIN+"/_build/"+BUILD+"/");require(Arrays.equals(bytes(lib.intercept(request(ORIGIN+"/media/TEST-AUDIO",null,"GET"))),all),"audio case alias");
  require(lib.intercept(request(ORIGIN+"/_build/changed"+PNG,null,"GET"))==null,"changed server hash must use network");require(lib.intercept(request(ORIGIN+"/_build/changed"+OBJ,null,"GET"))==null,"extras must not override future builds");
  require(Arrays.equals(bytes(lib.intercept(request("https://weishuxieyi.icu/_build/"+BUILD+PNG,null,"GET"))),original(PNG)),"ICU resources use their own manifest");require(Arrays.equals(bytes(lib.intercept(request(${JSON.stringify(cdn)},null,"GET"))),original(PNG)),"ICU validated CDN alias uses local bytes");require(lib.intercept(request("https://unknown.example/_build/"+BUILD+PNG,null,"GET"))==null,"foreign origins must not receive local resources");require(lib.intercept(request(ORIGIN+"/_build/"+BUILD+PNG,null,"POST"))==null,"POST fallback");
  ServerRegistry registry=new ServerRegistry(assets);require(registry.servers.size()==2,"two server cards");require(registry.servers.get(0).name.equals("8443服")&&registry.servers.get(1).name.equals("icu服"),"requested names");for(ServerRegistry.Server s:registry.servers){require(s.url.endsWith("/game.html"),"direct game URL");require(registry.contains(Uri.parse(s.url)),"registered HTTPS origin");}require(!registry.contains(Uri.parse("https://weishuxieyi.icu.evil.example/")),"foreign origin");require(!registry.contains(Uri.parse("http://weishuxieyi.icu/")),"HTTP origin");require(!registry.contains(Uri.parse("https://user@weishuxieyi.icu/")),"credential URL");
  System.out.println("native resource and server registry checks passed");
 }
}`};
const files=[];for(const [name,body]of Object.entries(sources)){const filename=path.join(qa,name);await fs.mkdir(path.dirname(filename),{recursive:true});await fs.writeFile(filename,body);files.push(filename);}
for(const filename of ['BundledResources.java','ServerRegistry.java'])files.push(root+'/android/src/cn/weishuxieyi/mobile/'+filename);
const jdk=root+'/tools/jdk/jdk-21.0.12.1+1/bin/';
function run(exe,args){const r=spawnSync(jdk+exe,args,{encoding:'utf8',maxBuffer:1048576,windowsHide:true});if(r.status!==0)throw Error(r.stderr||r.stdout||String(r.error));return r.stdout;}
await fs.mkdir(qa+'/classes',{recursive:true});run('javac.exe',['-encoding','UTF-8','-d',qa+'/classes',...files]);
const result=run('java.exe',['-cp',qa+'/classes','NativeTest',root+'/export/卫戍协议-安卓完整版-v1.0.2.apk']);
const receipt={ok:true,kind:'JVM with Android API adapters; not a device test',checks:['production interceptor returns APK bytes for concurrent first image requests with one manifest fetch','core bridge excludes optional audio and frozen-build extras','Windows case aliases and audio aliases','OBJ/JSON/font stylesheet extras with correct MIME types','audio range, suffix and invalid range','changed hashes and future-build extras fall back to network','other origins and POST do not receive bundled resources','signed registry has both direct game URLs with requested names and rejects foreign/HTTP/credential origins'],output:result.trim()};
await fs.writeFile(root+'/export/native-verification.json',JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));
