package cn.weishuxieyi.mobile;

import android.content.res.AssetManager;
import android.net.Uri;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.json.*;

/** The signed app owns the server list; site navigation cannot change it. */
public final class ServerRegistry {
    public static final class Server {
        public final String id,name,url,badge,description;
        Server(JSONObject value)throws Exception {
            id=value.getString("id");name=value.getString("name");url=value.getString("url");
            badge=value.optString("badge","社区服务器");description=value.optString("description","");
            Uri uri=Uri.parse(url);
            if(!id.matches("[A-Za-z0-9_-]{1,40}")||name.isEmpty()||name.length()>40||!"https".equalsIgnoreCase(uri.getScheme())||uri.getHost()==null||uri.getUserInfo()!=null||uri.getFragment()!=null)throw new IOException("Invalid server entry");
        }
    }
    public final List<Server> servers;
    public ServerRegistry(AssetManager assets)throws Exception {
        byte[] raw;try(InputStream in=assets.open("servers.json");ByteArrayOutputStream out=new ByteArrayOutputStream()){
            byte[] buffer=new byte[4096];int n;while((n=in.read(buffer))!=-1){if(out.size()+n>65536)throw new IOException("Server list too large");out.write(buffer,0,n);}raw=out.toByteArray();
        }
        JSONObject registry=new JSONObject(new String(raw,StandardCharsets.UTF_8));JSONArray entries=registry.getJSONArray("servers");
        if(registry.optInt("version")!=1||entries.length()==0||entries.length()>30)throw new IOException("Invalid server list");
        List<Server> list=new ArrayList<>();Set<String> ids=new HashSet<>();
        for(int i=0;i<entries.length();i++){Server server=new Server(entries.getJSONObject(i));if(!ids.add(server.id))throw new IOException("Duplicate server");list.add(server);}
        servers=Collections.unmodifiableList(list);
    }
    public boolean contains(Uri uri){
        if(!"https".equalsIgnoreCase(uri.getScheme())||uri.getHost()==null||uri.getUserInfo()!=null)return false;
        int port=uri.getPort()==-1?443:uri.getPort();
        for(Server server:servers){Uri base=Uri.parse(server.url);if(uri.getHost().equalsIgnoreCase(base.getHost())&&port==(base.getPort()==-1?443:base.getPort()))return true;}
        return false;
    }
}
