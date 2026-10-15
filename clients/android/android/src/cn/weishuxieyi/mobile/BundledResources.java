package cn.weishuxieyi.mobile;

import android.content.res.AssetManager;
import android.net.Uri;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.*;
import java.util.zip.GZIPInputStream;
import org.json.*;

/** Immutable APK assets. Server snapshots decide which hash each live URL expects. */
public final class BundledResources {
    private static final String ICU="https://weishuxieyi.icu";
    private final AssetManager assets;
    private final Map<String,Item> byHash=new HashMap<>();
    private final ConcurrentHashMap<String,Snapshot> snapshots=new ConcurrentHashMap<>();
    private final Map<String,JSONObject> extras=new HashMap<>();
    private final Set<String> extraBuilds=new HashSet<>();
    private final JSONObject extrasByBuild;
    private final String coreJson;
    private final ConcurrentHashMap<String,String> activeBuilds=new ConcurrentHashMap<>();
    private static final Pattern BUILD=Pattern.compile("^/_build/([A-Za-z0-9_-]{1,80})/(.*)$");
    private static final class Item {final String path;final long bytes;Item(String p,long n){path=p;bytes=n;}}
    private static final class Snapshot {
        final JSONObject entries,aliases;final byte[] raw;
        final Map<String,JSONObject> folded=new HashMap<>();
        final Map<String,String> aliasFolded=new HashMap<>();
        final Map<String,String> cdn=new HashMap<>();
        Snapshot(JSONObject m,byte[] r)throws JSONException{
            entries=m.getJSONObject("entries");aliases=m.optJSONObject("aliases");raw=r;
            for(Iterator<String> it=entries.keys();it.hasNext();){String key=it.next(),lower=key.toLowerCase(Locale.ROOT);folded.put(lower,folded.containsKey(lower)?null:entries.getJSONObject(key));}
            if(aliases!=null)for(Iterator<String> it=aliases.keys();it.hasNext();){String key=it.next(),lower=key.toLowerCase(Locale.ROOT);aliasFolded.put(lower,aliasFolded.containsKey(lower)?null:aliases.getString(key));}
            for(Iterator<String> it=entries.keys();it.hasNext();){String key=it.next();JSONObject item=entries.getJSONObject(key);String url=item.optString("cdn","");Uri uri=Uri.parse(url);if("https".equals(uri.getScheme())&&"assets.weishuxieyi.icu".equals(uri.getHost())&&(uri.getPort()==-1||uri.getPort()==443)&&uri.getUserInfo()==null&&uri.getEncodedPath()!=null&&uri.getEncodedPath().startsWith("/pilot/content/"+item.getString("hash")+".")&&url.indexOf('?')<0&&url.indexOf('#')<0)cdn.put(url,key);}
        }
    }

    public BundledResources(AssetManager manager)throws Exception {
        assets=manager;
        JSONObject manifest=new JSONObject(new String(readBounded(assets.open("pack/manifest.json"),8*1024*1024),StandardCharsets.UTF_8));
        extrasByBuild=manifest.optJSONObject("extrasByBuild");
        JSONObject entries=manifest.getJSONObject("entries"),extraEntries=manifest.optJSONObject("extras");JSONArray core=new JSONArray();Set<String> coreHashes=new HashSet<>();
        JSONArray builds=manifest.optJSONArray("extraBuilds");
        if(builds!=null)for(int i=0;i<builds.length();i++){String build=builds.getString(i);if(!build.matches("[A-Za-z0-9_-]{1,80}"))throw new IOException("Invalid extra build");extraBuilds.add(build);}
        Iterator<String> names=entries.keys();
        while(names.hasNext()){
            String name=names.next();JSONObject value=entries.getJSONObject(name);String hash=value.getString("hash");long size=value.getLong("bytes");
            if(!name.matches("^/(assets|fonts)/.+")||!hash.matches("[a-f0-9]{64}")||size<=0||size>33554432)throw new IOException("Invalid bundled manifest");
            String decoded=Uri.decode(name.substring(1));
            for(String segment:decoded.split("/"))if(segment.equals("..")||segment.equals(".")||segment.isEmpty())throw new IOException("Invalid asset path");
            if(decoded.indexOf('\\')>=0)throw new IOException("Invalid asset path");
            Item existing=byHash.get(hash);if(existing!=null&&existing.bytes!=size)throw new IOException("Conflicting asset size");
            byHash.put(hash,new Item("pack/"+decoded,size));
            boolean extra=extraEntries!=null&&extraEntries.has(name);
            if(extra){JSONObject expected=extraEntries.getJSONObject(name);if(!hash.equals(expected.getString("hash"))||size!=expected.getLong("bytes"))throw new IOException("Invalid extra hash");extras.put(name,value);}
            if(!extra&&!name.toLowerCase(Locale.ROOT).matches(".*\\.(mp3|ogg|wav|m4a|aac|flac|opus|mp4|webm)$")&&coreHashes.add(hash))core.put(new JSONObject().put("hash",hash).put("bytes",size));
        }
        coreJson=new JSONObject().put("version",1).put("source","android-bundled").put("files",entries.length()).put("entries",core).toString();
    }
    @JavascriptInterface public String getManifest(){return coreJson;}
    public void setPage(String url){try{Uri uri=Uri.parse(url);Matcher m=BUILD.matcher(uri.getEncodedPath());if(resourceOrigin(uri)&&m.matches())activeBuilds.put(origin(uri),m.group(1));}catch(Exception ignored){}}
    public static boolean trusted(Uri uri){return "https".equalsIgnoreCase(uri.getScheme())&&"weishuxieyiwangye.cn".equalsIgnoreCase(uri.getHost())&&uri.getPort()==8443;}
    private static boolean resourceOrigin(Uri uri){return trusted(uri)||("https".equalsIgnoreCase(uri.getScheme())&&"weishuxieyi.icu".equalsIgnoreCase(uri.getHost())&&(uri.getPort()==-1||uri.getPort()==443)&&uri.getUserInfo()==null);}
    private static String origin(Uri uri){return "https://"+uri.getHost().toLowerCase(Locale.ROOT)+(uri.getPort()==-1||uri.getPort()==443?"":":"+uri.getPort());}
    private static byte[] readBounded(InputStream input,int limit)throws IOException{try(InputStream in=input;ByteArrayOutputStream out=new ByteArrayOutputStream()){byte[] chunk=new byte[16384];int n;while((n=in.read(chunk))!=-1){if(out.size()+n>limit)throw new IOException("Resource manifest too large");out.write(chunk,0,n);}return out.toByteArray();}}
    private Snapshot load(String key,String url)throws Exception{
        Snapshot cached=snapshots.get(key);if(cached!=null)return cached;
        synchronized(snapshots){
            cached=snapshots.get(key);if(cached!=null)return cached;
            HttpURLConnection connection=(HttpURLConnection)new URL(url).openConnection();connection.setConnectTimeout(15000);connection.setReadTimeout(20000);connection.setInstanceFollowRedirects(false);connection.setRequestProperty("Accept-Encoding","gzip");
            byte[] raw;try{if(connection.getResponseCode()!=200)throw new IOException("Manifest unavailable");InputStream input=connection.getInputStream();if("gzip".equalsIgnoreCase(connection.getContentEncoding()))input=new GZIPInputStream(input);raw=readBounded(input,8*1024*1024);}finally{connection.disconnect();}
            JSONObject value=new JSONObject(new String(raw,StandardCharsets.UTF_8));if(value.optInt("version")!=1||value.getJSONObject("entries").length()>50000)throw new IOException("Invalid server manifest");
            Snapshot snapshot=new Snapshot(value,raw);if(snapshots.size()>=8)snapshots.clear();snapshots.put(key,snapshot);return snapshot;
        }
    }
    private static String canonical(String path){String decoded=Uri.decode(path).replaceFirst("^/(assets|fonts|media)/~[a-f0-9]{16}(/)","/$1$2");StringBuilder result=new StringBuilder();for(String part:decoded.split("/",-1)){if(result.length()>0||!part.isEmpty())result.append('/');result.append(Uri.encode(part));}return result.toString();}
    private static WebResourceResponse missing(Uri uri){
        if(!trusted(uri))return null;
        String path=uri.getEncodedPath();if(path==null)return null;Matcher build=BUILD.matcher(path);if(build.matches())path="/"+build.group(2);
        if(!path.matches("^/(assets|fonts|media)/.+"))return null;
        Map<String,String> headers=new HashMap<>();headers.put("Cache-Control","no-store");headers.put("Access-Control-Allow-Origin","*");headers.put("X-SP-Native-Resource","LOCAL-MISSING");
        if(path.startsWith("/media/")||path.toLowerCase(Locale.ROOT).matches(".*\\.(mp3|ogg|oga|opus|wav|m4a|aac|flac)$")){
            byte[] body=new byte[8044];java.nio.ByteBuffer b=java.nio.ByteBuffer.wrap(body).order(java.nio.ByteOrder.LITTLE_ENDIAN);
            b.put("RIFF".getBytes(StandardCharsets.US_ASCII)).putInt(8036).put("WAVEfmt ".getBytes(StandardCharsets.US_ASCII)).putInt(16).putShort((short)1).putShort((short)1).putInt(8000).putInt(8000).putShort((short)1).putShort((short)8).put("data".getBytes(StandardCharsets.US_ASCII)).putInt(8000);Arrays.fill(body,44,body.length,(byte)128);
            headers.put("Content-Length",String.valueOf(body.length));return new WebResourceResponse("audio/wav",null,200,"OK",headers,new ByteArrayInputStream(body));
        }
        byte[] body="Local resources unavailable; reinstall the complete client or resource update.".getBytes(StandardCharsets.UTF_8);headers.put("Content-Length",String.valueOf(body.length));return new WebResourceResponse("text/plain","UTF-8",503,"Local Resource Missing",headers,new ByteArrayInputStream(body));
    }
    public WebResourceResponse intercept(WebResourceRequest request){
        Uri uri=request.getUrl();if(!"GET".equals(request.getMethod()))return null;
        try{
            if(!resourceOrigin(uri)){
                if(!"https".equals(uri.getScheme())||!"assets.weishuxieyi.icu".equals(uri.getHost())||(uri.getPort()!=-1&&uri.getPort()!=443))return null;
                String build=activeBuilds.get(ICU);Snapshot snapshot=build==null?null:snapshots.get(ICU+"/"+build);String path=snapshot==null?null:snapshot.cdn.get(uri.toString());
                JSONObject expected=path==null?null:snapshot.entries.optJSONObject(path);Item item=expected==null?null:byHash.get(expected.optString("hash"));
                return item!=null&&item.bytes==expected.optLong("bytes")?asset(item,request.getRequestHeaders(),path):null;
            }
            String origin=origin(uri),encoded=uri.getEncodedPath(),build=activeBuilds.get(origin),path=encoded;Matcher match=BUILD.matcher(encoded);
            if(match.matches()){build=match.group(1);path="/"+match.group(2);activeBuilds.put(origin,build);}
            if(build==null)return missing(uri);
            if(build.isEmpty())return missing(uri);
            String key=origin+"/"+build,manifestUrl=origin+"/_build/"+build+"/data/resource-cache.json";
            if(path.equals("/data/resource-cache.json")){
                Snapshot snapshot=load(key,manifestUrl);
                Map<String,String> h=new HashMap<>();h.put("Cache-Control","no-store");h.put("Content-Length",String.valueOf(snapshot.raw.length));
                return new WebResourceResponse("application/json","UTF-8",200,"OK",h,new ByteArrayInputStream(snapshot.raw));
            }
            if(!path.startsWith("/assets/")&&!path.startsWith("/fonts/")&&!path.startsWith("/media/"))return null;
            Snapshot snapshot=load(key,manifestUrl);
            path=canonical(path);if(path.startsWith("/media/")){if(snapshot.aliases==null)return missing(uri);String alias=snapshot.aliases.optString(path,"");if(alias.isEmpty())alias=snapshot.aliasFolded.get(path.toLowerCase(Locale.ROOT));if(alias==null||alias.isEmpty())return missing(uri);path=alias;}
            JSONObject expected=snapshot.entries.optJSONObject(path);if(expected==null)expected=snapshot.folded.get(path.toLowerCase(Locale.ROOT));
            // Extras omitted by the old server manifest are valid only for their frozen build.
            if(expected==null&&extraBuilds.contains(build))expected=extras.get(path);
            if(expected==null&&extrasByBuild!=null){JSONObject scoped=extrasByBuild.optJSONObject(build);if(scoped!=null)expected=scoped.optJSONObject(path);}
            if(expected==null)return missing(uri);
            Item item=byHash.get(expected.optString("hash"));if(item==null||item.bytes!=expected.optLong("bytes"))return missing(uri);
            return asset(item,request.getRequestHeaders(),path);
        }catch(Exception ignored){return missing(uri);}
    }
    private WebResourceResponse asset(Item item,Map<String,String> requestHeaders,String url)throws IOException{
        String range=null;for(Map.Entry<String,String> h:requestHeaders.entrySet())if(h.getKey().equalsIgnoreCase("Range"))range=h.getValue();
        long start=0,end=item.bytes-1;int status=200;Map<String,String> headers=new HashMap<>();headers.put("Cache-Control","no-store");headers.put("Accept-Ranges","bytes");headers.put("Access-Control-Allow-Origin","*");headers.put("Cross-Origin-Resource-Policy","cross-origin");headers.put("X-SP-Native-Resource","BUNDLED");headers.put("X-SP-Resource-Bytes",String.valueOf(item.bytes));
        if(range!=null){
            Matcher m=Pattern.compile("bytes=(\\d*)-(\\d*)").matcher(range);boolean valid=m.matches()&&!(m.group(1).isEmpty()&&m.group(2).isEmpty());
            try{if(valid){if(m.group(1).isEmpty()){long suffix=Long.parseLong(m.group(2));valid=suffix>0;start=Math.max(0,item.bytes-suffix);}else{start=Long.parseLong(m.group(1));if(!m.group(2).isEmpty())end=Math.min(end,Long.parseLong(m.group(2)));}valid=valid&&start>=0&&start<=end&&start<item.bytes;}}catch(NumberFormatException e){valid=false;}
            if(!valid){headers.put("Content-Range","bytes */"+item.bytes);return new WebResourceResponse(mime(url),null,416,"Range Not Satisfiable",headers,new ByteArrayInputStream(new byte[0]));}
            status=206;headers.put("Content-Range","bytes "+start+"-"+end+"/"+item.bytes);
        }
        InputStream input=assets.open(item.path,AssetManager.ACCESS_STREAMING);
        try{long skip=start;while(skip>0){long n=input.skip(skip);if(n>0)skip-=n;else if(input.read()!=-1)skip--;else throw new EOFException();}}catch(IOException e){input.close();throw e;}
        final long length=end-start+1;headers.put("Content-Length",String.valueOf(length));
        InputStream bounded=new FilterInputStream(input){long remaining=length;@Override public int read()throws IOException{if(remaining<=0)return -1;int n=super.read();if(n>=0)remaining--;return n;}@Override public int read(byte[] b,int off,int len)throws IOException{if(remaining<=0)return -1;int n=in.read(b,off,(int)Math.min(remaining,len));if(n>0)remaining-=n;return n;}};
        String type=mime(url);return new WebResourceResponse(type,type.startsWith("text/")?"UTF-8":null,status,status==206?"Partial Content":"OK",headers,bounded);
    }
    private static String mime(String path){String ext=path.substring(path.lastIndexOf('.')+1).toLowerCase(Locale.ROOT);switch(ext){case"png":return"image/png";case"jpg":case"jpeg":return"image/jpeg";case"webp":return"image/webp";case"gif":return"image/gif";case"svg":return"image/svg+xml";case"avif":return"image/avif";case"mp3":return"audio/mpeg";case"ogg":return"audio/ogg";case"wav":return"audio/wav";case"m4a":return"audio/mp4";case"aac":return"audio/aac";case"flac":return"audio/flac";case"opus":return"audio/opus";case"woff":return"font/woff";case"woff2":return"font/woff2";case"ttf":return"font/ttf";case"otf":return"font/otf";case"atlas":case"obj":return"text/plain";case"json":return"application/json";case"css":return"text/css";default:return"application/octet-stream";}}
}
