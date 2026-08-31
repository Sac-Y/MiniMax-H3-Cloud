import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const PLATFORMS = Object.freeze({
  compshare: Object.freeze({
    id: "compshare",
    label: "优云智算",
    registrationUrl: "https://passport.compshare.cn/register?referral_code=2N6NKqFVowEIxce0PT4kK",
    apiKeyUrl: "https://console.compshare.cn/uaccount/api_manage",
    resourceConfigUrl:
      "https://console.compshare.cn/light-gpu/console/resources",
    imageId: "compshareImage-1uiyk4t8fyce",
    resourceOptions: Object.freeze([
      Object.freeze({
        id: "5090-96gb",
        title: "RTX 5090 · 96GB 系统内存",
        hardware: Object.freeze({
          gpu: "5090",
          gpuMemoryGiB: 32,
          cpu: 16,
          systemMemoryGiB: 96,
        }),
        evidenceStatus: "certified",
        referencePrice: "历史约 ¥3.15–3.37/小时",
        reason: "性能余量更大，适合高频生成",
        caveat: "价格最高，库存可能波动",
        deploymentBinding:
          "deployments/compshare/official-comfyui-033-5090-turbo.json",
        runtimeProfile:
          "profiles/compshare-official-h3-turbo-8step-033-v1.json",
      }),
      Object.freeze({
        id: "5090-64gb",
        title: "RTX 5090 · 64GB 系统内存",
        hardware: Object.freeze({
          gpu: "5090",
          gpuMemoryGiB: 32,
          cpu: 14,
          systemMemoryGiB: 64,
        }),
        evidenceStatus: "candidate",
        referencePrice: "历史约 ¥2.58/小时",
        reason: "兼顾生成速度与小时成本",
        caveat: "系统内存余量低于 96GB 档",
        deploymentBinding:
          "deployments/compshare/official-comfyui-033-5090-64gb-turbo-candidate.json",
        runtimeProfile:
          "profiles/compshare-official-h3-turbo-8step-033-64gb-candidate.json",
      }),
      Object.freeze({
        id: "4090-64gb",
        title: "RTX 4090 · 64GB 系统内存",
        hardware: Object.freeze({
          gpu: "4090",
          gpuMemoryGiB: 24,
          cpu: 14,
          systemMemoryGiB: 64,
        }),
        evidenceStatus: "unverified",
        referencePrice: "历史约 ¥1.98/小时",
        reason: "小时成本最低，适合控制预算",
        caveat: "生成性能低于 5090 档",
        deploymentBinding:
          "deployments/compshare/official-comfyui-033-4090-64gb-turbo-experimental.json",
        runtimeProfile:
          "profiles/compshare-official-h3-turbo-8step-033-64gb-candidate.json",
      }),
    ]),
  }),
});

export function supportedPlatforms() {
  return Object.values(PLATFORMS).map(
    ({ id, label, registrationUrl, apiKeyUrl, resourceConfigUrl }) => ({
      id,
      label,
      registrationUrl,
      apiKeyUrl,
      resourceConfigUrl,
      canBrowseAllResources: true,
    }),
  );
}

function publicResourceOption(option) {
  return {
    id: option.id,
    title: option.title,
    hardware: { ...option.hardware },
    evidenceStatus: option.evidenceStatus,
    referencePrice: option.referencePrice,
    priceDisplay: option.referencePrice,
    priceSource: "reference",
    reason: option.reason,
    caveat: option.caveat,
  };
}

export function resourceOptions(platform) {
  const selected = PLATFORMS[platform];
  if (!selected) throw new Error(`暂不支持平台：${platform}`);
  return selected.resourceOptions.map(publicResourceOption);
}

export function platformCatalog(platform) {
  const selected = PLATFORMS[platform];
  if (!selected) throw new Error(`暂不支持平台：${platform}`);
  return {
    id: selected.id,
    label: selected.label,
    registrationUrl: selected.registrationUrl,
    apiKeyUrl: selected.apiKeyUrl,
    resourceConfigUrl: selected.resourceConfigUrl,
    imageId: selected.imageId,
  };
}

export function createUserConfig({
  platform,
  credentialProfile,
  resourceOption,
}) {
  const selected = PLATFORMS[platform];
  if (!selected) throw new Error(`暂不支持平台：${platform}`);
  if (!credentialProfile?.trim()) throw new Error("缺少凭证配置名称");
  const selectedResource = selected.resourceOptions.find(
    (option) => option.id === resourceOption,
  );
  if (!selectedResource) {
    throw new Error(`必须选择有效的算力配置：${resourceOption ?? "未选择"}`);
  }

  return {
    provider: {
      type: selected.id,
      credentialProfile: credentialProfile.trim(),
      resourceId: "",
    },
    resourceSelection: {
      id: selectedResource.id,
      title: selectedResource.title,
      evidenceStatus: selectedResource.evidenceStatus,
    },
    deploymentBinding: selectedResource.deploymentBinding,
    runtimeProfile: selectedResource.runtimeProfile,
    safety: {
      scheduleStopAfter: "30m",
      stopAfterJob: true,
    },
  };
}

export async function writeUserConfig(path, config) {
  const selectedPath = resolve(path);
  await mkdir(dirname(selectedPath), { recursive: true });
  await writeFile(selectedPath, `${JSON.stringify(config, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  return selectedPath;
}
