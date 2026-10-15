# 安卓 1.0.2 源码

独立选服大厅＋Android WebView＋APK内置素材。安卓版没有PC的本地Mod入口。

Windows构建需要自行安装JDK21、Android SDK Build Tools（脚本指定版本）与Android35平台，放到`tools`中对应目录；也可以按自身SDK布局修改`build.mjs`的工具路径。将合法来源素材准备到仓库根目录`public/assets`及`public/fonts`，再通过PowerShell运行`build.ps1`。打包时会核对`resource-manifest.json`。

签名由构建者本地`private`目录生成并保存。该目录不上传GitHub。新构建的APK无法直接覆盖使用其他签名安装的原客户端；正式发布升级必须由持有原签名的服主打包。
