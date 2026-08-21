const path = require("path");

module.exports = env => {
  const entries = {
    control: path.resolve(__dirname, "src/control/index.ts")
  };

  if (env && env.harness) {
    entries["test-harness"] = path.resolve(__dirname, "src/test-harness.ts");
  }

  return {
    entry: entries,
    output: {
      filename: "[name].js",
      path: path.resolve(__dirname, "dist")
    },
    resolve: { extensions: [".ts", ".js"] },
    module: {
      rules: [{ test: /\.ts$/, use: "ts-loader", exclude: /node_modules/ }]
    }
  };
};
