const path = require('path');

module.exports = {
    mode: 'development',
    entry: './public/index02.js', // 클라이언트 코드 진입점
    output: {
    filename: 'bundle.js', // 빌드된 번들 파일 이름
    path: path.resolve(__dirname, 'public/dist'), // 출력 디렉토리
  },
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
        },
      },
    ],
  },
  devServer: {
    static: path.resolve(__dirname, 'public'),
    port: 3000,
    open: true,
  },
  resolve: {
    extensions: ['.js', '.json'],
  },
};