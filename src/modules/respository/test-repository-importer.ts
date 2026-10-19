import { RepositoryImporterService } from "./services/repository-importer.service.js";

async function main() {
    const importer = new RepositoryImporterService();

    const result = await importer.importRepository({
        sourceType: "git",
        source: "https://github.com/octocat/Hello-World.git"
    });

    console.log("\nFINAL DEMO RESULT");
    console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});