import { it, expect } from "vitest";
import { gitCloneArguments } from "./git-cloner.service.js";
it("preserves branch/depth, supports tag and rejects ambiguous or option-like refs", () => {
    expect(gitCloneArguments({ branch: "main", shallow: true })).toEqual(["--branch", "main", "--depth", "1"]);
    expect(gitCloneArguments({ tag: "v1" })).toEqual(["--branch", "v1"]);
    expect(() => gitCloneArguments({ tag: "v1", branch: "main" })).toThrow();
    expect(() => gitCloneArguments({ commit: "--unsafe" })).toThrow();
});
