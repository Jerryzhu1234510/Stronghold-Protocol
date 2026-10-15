package cn.weishuxieyi.mobile;

import android.app.Activity;
import android.content.*;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.view.*;
import android.widget.*;
import java.util.List;

/** Offline native launcher. Game websites never need to render a second server picker. */
public final class LauncherView extends ScrollView {
    public interface Actions {void enter(ServerRegistry.Server server);void updates();}
    private final int ink=Color.rgb(233,244,240),muted=Color.rgb(156,183,175),accent=Color.rgb(150,235,211);
    private final Activity activity;
    public LauncherView(Activity host,List<ServerRegistry.Server> servers,Actions actions){
        super(host);activity=host;setFillViewport(true);setBackgroundColor(Color.rgb(11,20,19));
        LinearLayout content=new LinearLayout(host);content.setOrientation(LinearLayout.VERTICAL);content.setPadding(dp(22),dp(30),dp(22),dp(26));addView(content,new ScrollView.LayoutParams(-1,-2));
        TextView brand=text("SP  /  STRONGHOLD PROTOCOL",12,accent,true);content.addView(brand);
        TextView title=text("卫戍协议 · 联机大厅",28,ink,true);content.addView(title,spaced(12));
        TextView intro=text("选择服务器，直接进入游戏。",15,muted,false);content.addView(intro,spaced(8));
        for(int i=0;i<servers.size();i++){
            ServerRegistry.Server server=servers.get(i);LinearLayout card=new LinearLayout(host);card.setOrientation(LinearLayout.VERTICAL);card.setPadding(dp(20),dp(18),dp(20),dp(18));card.setBackground(panel());
            card.addView(text(String.format(java.util.Locale.ROOT,"SERVER %02d  ·  %s",i+1,server.badge),12,accent,true));
            card.addView(text(server.name,25,ink,true),spaced(12));
            TextView description=text(server.description,14,muted,false);description.setLineSpacing(dp(4),1);card.addView(description,spaced(10));
            Button enter=new Button(host);enter.setText("进入 "+server.name+"  →");enter.setTextSize(16);enter.setTextColor(Color.rgb(9,32,25));enter.setAllCaps(false);enter.setBackground(button());enter.setMinHeight(dp(52));enter.setOnClickListener(v->actions.enter(server));card.addView(enter,spaced(18));
            content.addView(card,spaced(20));
        }
        TextView help=text("两服账号独立；联机和游戏数据仍需联网。\n游戏内按系统返回键，可回到这里切换服务器。",13,muted,false);help.setLineSpacing(dp(5),1);content.addView(help,spaced(20));
        Button copy=new Button(host);copy.setAllCaps(false);copy.setText("复制新QQ群号：455814975");copy.setTextColor(accent);copy.setBackground(panel());copy.setMinHeight(dp(48));copy.setOnClickListener(v->{ClipboardManager clipboard=(ClipboardManager)host.getSystemService(Context.CLIPBOARD_SERVICE);clipboard.setPrimaryClip(ClipData.newPlainText("卫戍协议新QQ群","455814975"));Toast.makeText(host,"已复制：455814975",Toast.LENGTH_SHORT).show();});content.addView(copy,spaced(20));
        TextView update=text("资源包与更新下载  ↗",14,accent,true);update.setPadding(dp(4),dp(16),dp(4),dp(16));update.setOnClickListener(v->actions.updates());update.setFocusable(true);update.setContentDescription("在系统浏览器打开资源包与更新下载");content.addView(update,spaced(4));
        content.addView(text("安卓客户端 1.0.2 · 原群 1095895855 已满",12,muted,false),spaced(4));
    }
    private int dp(int value){return Math.round(value*getResources().getDisplayMetrics().density);}
    private TextView text(String value,int size,int color,boolean bold){TextView view=new TextView(activity);view.setText(value);view.setTextSize(size);view.setTextColor(color);if(bold)view.setTypeface(Typeface.DEFAULT,Typeface.BOLD);return view;}
    private LinearLayout.LayoutParams spaced(int margin){LinearLayout.LayoutParams params=new LinearLayout.LayoutParams(-1,-2);params.topMargin=dp(margin);return params;}
    private GradientDrawable panel(){GradientDrawable drawable=new GradientDrawable();drawable.setColor(Color.rgb(22,38,34));drawable.setCornerRadius(dp(14));drawable.setStroke(dp(1),Color.rgb(56,82,73));return drawable;}
    private GradientDrawable button(){GradientDrawable drawable=new GradientDrawable();drawable.setColor(accent);drawable.setCornerRadius(dp(9));return drawable;}
}
