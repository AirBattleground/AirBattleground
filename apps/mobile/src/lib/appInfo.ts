import * as Application from "expo-application";
import Constants from "expo-constants";

export const appVersion = Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? "1.0.0";
export const appBuild = Number(Application.nativeBuildVersion ?? Constants.expoConfig?.android?.versionCode ?? 1);
