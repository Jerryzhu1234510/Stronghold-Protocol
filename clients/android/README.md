# 安卓 1.0.3 源码

独立选服大厅＋Android WebView＋APK内置素材。安卓版没有PC的本地Mod入口。

1.0.3 修复带内容哈希的图片、模型、音频地址绕过内置素材的问题。8443服缺少或不匹配素材时，不再自动下载大文件；缺失核心素材返回错误，缺失可选音频暂用静音。其他服保留原有资源策略。正式包由原签名打包，可直接覆盖安装1.0.2，无需卸载。

Windows构建需要自行安装JDK21、Android SDK Build Tools（脚本指定版本）与Android35平台，放到`tools`中对应目录；也可以按自身SDK布局修改`build.mjs`的工具路径。将合法来源素材准备到仓库根目录`public/assets`及`public/fonts`，再通过PowerShell运行`build.ps1`。打包时会核对`resource-manifest.json`。

需要隔离构建时，可以通过`SP_MOBILE_BUILD_ROOT`指定构建目录，通过`SP_MOBILE_RESOURCE_ROOT`指定素材根目录，通过`SP_MOBILE_SIGNING_ROOT`指定原签名的私有目录。不要将签名文件加入仓库。

签名由构建者本地`private`目录生成并保存。该目录不上传GitHub。新构建的APK无法直接覆盖使用其他签名安装的原客户端；正式发布升级必须由持有原签名的服主打包。
