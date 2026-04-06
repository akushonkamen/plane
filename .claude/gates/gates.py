"""
门禁系统 - 质量关卡检查

支持多种门禁类型：
- CommandGate: 执行 shell 命令（test, lint, type, format）
- CommitGate: 检查 commit 消息格式
- PRGate: 检查 PR 标题和描述
"""

import os
import re
import subprocess
from dataclasses import dataclass
from enum import Enum
from typing import List


class GateStatus(Enum):
    """门禁状态"""
    PASS = "pass"
    FAIL = "fail"
    WARN = "warn"
    SKIPPED = "skipped"


@dataclass
class GateResult:
    """门禁执行结果"""
    name: str
    status: GateStatus
    output: str = ""
    error: str = ""
    duration_ms: int = 0
    fail_action: str = "block"


@dataclass
class GateConfig:
    """门禁配置"""
    enabled: bool = True
    command: str = ""
    pattern: str = ""
    fail_action: str = "block"
    require_body: bool = False
    title_pattern: str = ""
    min_coverage: float = 0.0  # 覆盖率阈值（如 80.0 表示 80%）


class BaseGate:
    """门禁基类"""

    # GateConfig 已知的字段名
    _KNOWN_FIELDS = {"enabled", "command", "pattern", "fail_action", "require_body", "title_pattern", "min_coverage"}

    def __init__(self, name: str, config: dict):
        self.name = name
        self.raw_config = config  # 保留完整配置供子类使用
        self.config = GateConfig(**{k: v for k, v in config.items() if k in self._KNOWN_FIELDS})

    def run(self, repo_path: str, **kwargs) -> GateResult:
        """执行门禁检查，子类实现"""
        raise NotImplementedError


class CommandGate(BaseGate):
    """执行命令的门禁（test, lint, type, format）"""

    def run(self, repo_path: str, **kwargs) -> GateResult:
        if not self.config.enabled or not self.config.command:
            return GateResult(
                name=self.name,
                status=GateStatus.SKIPPED,
                fail_action=self.config.fail_action,
            )

        import time
        start = time.time()
        try:
            result = subprocess.run(
                self.config.command.split(),
                cwd=repo_path,
                capture_output=True,
                text=True,
                timeout=120,
            )
            duration = int((time.time() - start) * 1000)

            if result.returncode == 0:
                return GateResult(
                    name=self.name,
                    status=GateStatus.PASS,
                    output=result.stdout,
                    duration_ms=duration,
                    fail_action=self.config.fail_action,
                )
            else:
                return GateResult(
                    name=self.name,
                    status=GateStatus.FAIL,
                    output=result.stdout,
                    error=result.stderr,
                    duration_ms=duration,
                    fail_action=self.config.fail_action,
                )
        except subprocess.TimeoutExpired:
            return GateResult(
                name=self.name,
                status=GateStatus.FAIL,
                error="Command timed out (120s)",
                duration_ms=120000,
                fail_action=self.config.fail_action,
            )
        except Exception as e:
            return GateResult(
                name=self.name,
                status=GateStatus.FAIL,
                error=str(e),
                fail_action=self.config.fail_action,
            )


class CoverageGate(BaseGate):
    """测试覆盖率门禁 - 运行 coverage 命令并检查是否达到阈值"""

    def run(self, repo_path: str, **kwargs) -> GateResult:
        if not self.config.enabled or not self.config.command:
            return GateResult(
                name=self.name,
                status=GateStatus.SKIPPED,
                fail_action=self.config.fail_action,
            )

        import time
        start = time.time()
        try:
            # 运行覆盖率命令
            result = subprocess.run(
                self.config.command.split(),
                cwd=repo_path,
                capture_output=True,
                text=True,
                timeout=120,
            )
            duration = int((time.time() - start) * 1000)

            output = result.stdout + result.stderr

            # 从输出中提取覆盖率百分比
            coverage = self._parse_coverage(output)

            if coverage is None:
                # 无法解析覆盖率，依赖命令返回码
                if result.returncode == 0:
                    return GateResult(
                        name=self.name,
                        status=GateStatus.PASS,
                        output=output,
                        duration_ms=duration,
                        fail_action=self.config.fail_action,
                    )
                else:
                    return GateResult(
                        name=self.name,
                        status=GateStatus.FAIL,
                        output=output,
                        error=result.stderr,
                        duration_ms=duration,
                        fail_action=self.config.fail_action,
                    )

            # 检查是否达到阈值
            threshold = self.config.min_coverage
            if coverage >= threshold:
                return GateResult(
                    name=self.name,
                    status=GateStatus.PASS,
                    output=f"Coverage: {coverage:.1f}% (threshold: {threshold:.1f}%)\n\n{output}",
                    duration_ms=duration,
                    fail_action=self.config.fail_action,
                )
            else:
                return GateResult(
                    name=self.name,
                    status=GateStatus.FAIL,
                    output=f"Coverage: {coverage:.1f}% (threshold: {threshold:.1f}%)\n\n{output}",
                    error=f"Coverage {coverage:.1f}% is below threshold {threshold:.1f}%",
                    duration_ms=duration,
                    fail_action=self.config.fail_action,
                )

        except subprocess.TimeoutExpired:
            return GateResult(
                name=self.name,
                status=GateStatus.FAIL,
                error="Coverage command timed out (120s)",
                duration_ms=120000,
                fail_action=self.config.fail_action,
            )
        except Exception as e:
            return GateResult(
                name=self.name,
                status=GateStatus.FAIL,
                error=str(e),
                fail_action=self.config.fail_action,
            )

    def _parse_coverage(self, output: str) -> float:
        """从 coverage 输出中提取覆盖率百分比"""
        # 匹配常见格式：
        # "TOTAL ... 85%"
        # "coverage: 85.2%"
        # "TOTAL   100    15    85%"
        patterns = [
            r'TOTAL.*?(\d+(?:\.\d+)?)%',                    # coverage report 总计行
            r'^\s*TOTAL\s+\d+\s+\d+\s+(\d+(?:\.\d+)?)%',   # 带行数的总计
            r'[Cc]overage[:\s]+(\d+(?:\.\d+)?)%',           # 通用格式
            r'(\d+(?:\.\d)?)%\s*(?:of|coverage)',           # 反向格式
        ]
        for pattern in patterns:
            match = re.search(pattern, output, re.MULTILINE)
            if match:
                return float(match.group(1))
        return None


class CommitGate(BaseGate):
    """Commit 消息格式检查"""

    def run(self, repo_path: str, commit_message: str = "", **kwargs) -> GateResult:
        if not self.config.enabled or not self.config.pattern:
            return GateResult(
                name=self.name,
                status=GateStatus.SKIPPED,
                fail_action=self.config.fail_action,
            )

        if not commit_message:
            return GateResult(
                name=self.name,
                status=GateStatus.SKIPPED,
                output="No commit message provided, skipping",
                fail_action=self.config.fail_action,
            )

        if re.match(self.config.pattern, commit_message):
            return GateResult(
                name=self.name,
                status=GateStatus.PASS,
                output=f"Commit message matches pattern: {self.config.pattern}",
                fail_action=self.config.fail_action,
            )
        else:
            return GateResult(
                name=self.name,
                status=GateStatus.FAIL,
                error=f"Commit message doesn't match pattern: {self.config.pattern}",
                output=f"Actual: {commit_message}",
                fail_action=self.config.fail_action,
            )


class PRGate(BaseGate):
    """PR 标题和描述检查"""

    def run(self, repo_path: str, pr_title: str = "", pr_body: str = "", **kwargs) -> GateResult:
        if not self.config.enabled:
            return GateResult(
                name=self.name,
                status=GateStatus.SKIPPED,
                fail_action=self.config.fail_action,
            )

        issues = []

        if self.config.title_pattern:
            if not pr_title or not re.match(self.config.title_pattern, pr_title):
                issues.append(f"PR title doesn't match pattern: {self.config.title_pattern}")

        if self.config.require_body and not pr_body.strip():
            issues.append("PR body is required but empty")

        if issues:
            return GateResult(
                name=self.name,
                status=GateStatus.FAIL,
                error="\n".join(issues),
                fail_action=self.config.fail_action,
            )

        return GateResult(
            name=self.name,
            status=GateStatus.PASS,
            output="PR title and body pass checks",
            fail_action=self.config.fail_action,
        )


class SecurityGate(CommandGate):
    """安全扫描门禁 - 运行 bandit 检查安全漏洞"""

    def run(self, repo_path: str, **kwargs) -> GateResult:
        if not self.config.enabled or not self.config.command:
            return GateResult(name=self.name, status=GateStatus.SKIPPED, fail_action=self.config.fail_action)

        import time
        start = time.time()
        try:
            result = subprocess.run(
                self.config.command.split(),
                cwd=repo_path, capture_output=True, text=True, timeout=120,
            )
            duration = int((time.time() - start) * 1000)

            # bandit -f json: 解析 JSON 检查实际漏洞
            try:
                import json
                data = json.loads(result.stdout)
                issues = data.get("results", [])
                if not issues:
                    return GateResult(name=self.name, status=GateStatus.PASS, output="No security issues found", duration_ms=duration, fail_action=self.config.fail_action)
                high = len([i for i in issues if i.get("issue_severity") == "HIGH"])
                medium = len([i for i in issues if i.get("issue_severity") == "MEDIUM"])
                low = len([i for i in issues if i.get("issue_severity") == "LOW"])
                summary = f"Security issues: {high} HIGH, {medium} MEDIUM, {low} LOW"
                details = "\n".join(f"[{i.get('issue_severity')}] {i.get('filename')}:{i.get('line_number')} - {i.get('issue_text')}" for i in issues[:20])
                return GateResult(name=self.name, status=GateStatus.FAIL, output=details, error=summary, duration_ms=duration, fail_action=self.config.fail_action)
            except (json.JSONDecodeError, KeyError):
                # JSON 解析失败，回退到 returncode 判断
                if result.returncode == 0:
                    return GateResult(name=self.name, status=GateStatus.PASS, output=result.stdout, duration_ms=duration, fail_action=self.config.fail_action)
                return GateResult(name=self.name, status=GateStatus.FAIL, output=result.stdout, error=result.stderr, duration_ms=duration, fail_action=self.config.fail_action)
        except subprocess.TimeoutExpired:
            return GateResult(name=self.name, status=GateStatus.FAIL, error="Security scan timed out (120s)", duration_ms=120000, fail_action=self.config.fail_action)
        except Exception as e:
            return GateResult(name=self.name, status=GateStatus.FAIL, error=str(e), fail_action=self.config.fail_action)


class ScopeGate(BaseGate):
    """文件变更范围检查 - 防止 AI 过度修改"""

    def __init__(self, name: str, config: dict):
        super().__init__(name, config)
        self.max_files = config.get("max_files", 20)
        self.max_lines = config.get("max_lines", 500)

    def run(self, repo_path: str, **kwargs) -> GateResult:
        if not self.config.enabled:
            return GateResult(
                name=self.name,
                status=GateStatus.SKIPPED,
                fail_action=self.config.fail_action,
            )

        try:
            # 获取 diff 统计
            result = subprocess.run(
                ["git", "diff", "--stat", "main"],
                cwd=repo_path, capture_output=True, text=True, timeout=30,
            )

            if result.returncode != 0:
                return GateResult(
                    name=self.name,
                    status=GateStatus.SKIPPED,
                    output="Cannot compute diff stat",
                    fail_action=self.config.fail_action,
                )

            stat_output = result.stdout.strip()
            if not stat_output:
                return GateResult(
                    name=self.name,
                    status=GateStatus.PASS,
                    output="No changes detected",
                    fail_action=self.config.fail_action,
                )

            # 解析变更文件数和行数
            lines = stat_output.split("\n")
            file_count = len([l for l in lines if l.strip() and "files changed" not in l])

            # 解析总行数
            total_added = 0
            total_removed = 0
            summary_match = re.search(r'(\d+) files? changed,?(?: (\d+) insertion[s?] \(\+\))?,?(?: (\d+) deletion[s?] \(-\))?', stat_output)
            if summary_match:
                total_added = int(summary_match.group(2) or 0)
                total_removed = int(summary_match.group(3) or 0)
            else:
                # 逐行解析
                for line in lines:
                    match = re.search(r'\|\s+\d+ (\+*)(-*)', line)
                    if match:
                        total_added += len(match.group(1))
                        total_removed += len(match.group(2))

            total_changes = total_added + total_removed

            issues = []
            if file_count > self.max_files:
                issues.append(f"Too many files changed: {file_count} (max: {self.max_files})")
            if total_changes > self.max_lines:
                issues.append(f"Too many lines changed: {total_changes} (max: {self.max_lines})")

            if issues:
                return GateResult(
                    name=self.name,
                    status=GateStatus.FAIL,
                    error="\n".join(issues),
                    output=stat_output,
                    fail_action=self.config.fail_action,
                )

            return GateResult(
                name=self.name,
                status=GateStatus.PASS,
                output=f"Files: {file_count}/{self.max_files}, Lines: {total_changes}/{self.max_lines}",
                fail_action=self.config.fail_action,
            )

        except Exception as e:
            return GateResult(
                name=self.name,
                status=GateStatus.FAIL,
                error=str(e),
                fail_action=self.config.fail_action,
            )


class TodoGate(BaseGate):
    """TODO/FIXME 检查 - 检测 AI 留下的未完成代码"""

    def __init__(self, name: str, config: dict):
        super().__init__(name, config)
        self.patterns = config.get("patterns", ["TODO", "FIXME", "HACK", "XXX", "PLACEHOLDER"])
        self.exclude = config.get("exclude", ["*.md", "*.txt", "*.yml", "*.yaml"])

    def run(self, repo_path: str, **kwargs) -> GateResult:
        if not self.config.enabled:
            return GateResult(
                name=self.name,
                status=GateStatus.SKIPPED,
                fail_action=self.config.fail_action,
            )

        try:
            # 只检查新增/修改的文件（相对于 main）
            diff_result = subprocess.run(
                ["git", "diff", "--name-only", "main"],
                cwd=repo_path, capture_output=True, text=True, timeout=30,
            )

            if diff_result.returncode != 0 or not diff_result.stdout.strip():
                return GateResult(
                    name=self.name,
                    status=GateStatus.PASS,
                    output="No changed files to check",
                    fail_action=self.config.fail_action,
                )

            changed_files = [f.strip() for f in diff_result.stdout.strip().split("\n") if f.strip()]
            findings = []

            for filepath in changed_files:
                # 跳过排除的文件类型
                if any(filepath.endswith(ext.replace("*", "")) for ext in self.exclude):
                    continue

                full_path = os.path.join(repo_path, filepath)
                if not os.path.isfile(full_path):
                    continue

                try:
                    with open(full_path, "r") as f:
                        for line_num, line in enumerate(f, 1):
                            for pattern in self.patterns:
                                if pattern in line:
                                    findings.append(f"{filepath}:{line_num}: {line.strip()}")
                except (UnicodeDecodeError, PermissionError):
                    continue

            if findings:
                return GateResult(
                    name=self.name,
                    status=GateStatus.FAIL,
                    error=f"Found {len(findings)} TODO/FIXME markers in changed files",
                    output="\n".join(findings),
                    fail_action=self.config.fail_action,
                )

            return GateResult(
                name=self.name,
                status=GateStatus.PASS,
                output="No TODO/FIXME markers found",
                fail_action=self.config.fail_action,
            )

        except Exception as e:
            return GateResult(
                name=self.name,
                status=GateStatus.FAIL,
                error=str(e),
                fail_action=self.config.fail_action,
            )


class ComplexityGate(BaseGate):
    """代码复杂度检查 - 使用 radon 检测圈复杂度"""

    def __init__(self, name: str, config: dict):
        super().__init__(name, config)
        self.max_complexity = config.get("max_complexity", 10)

    def run(self, repo_path: str, **kwargs) -> GateResult:
        if not self.config.enabled:
            return GateResult(
                name=self.name,
                status=GateStatus.SKIPPED,
                fail_action=self.config.fail_action,
            )

        try:
            result = subprocess.run(
                ["python3", "-m", "radon", "cc", ".", "-a", "-nc"],
                cwd=repo_path, capture_output=True, text=True, timeout=60,
            )

            output = result.stdout.strip()
            if not output:
                return GateResult(
                    name=self.name,
                    status=GateStatus.PASS,
                    output="No complex functions found",
                    fail_action=self.config.fail_action,
                )

            # 检查是否有超过阈值的复杂函数
            violations = []
            for line in output.split("\n"):
                # radon 输出格式: "F function_name (complexity) - A"
                match = re.search(r'\((\d+)\)', line)
                if match:
                    complexity = int(match.group(1))
                    if complexity > self.max_complexity:
                        violations.append(line.strip())

            if violations:
                return GateResult(
                    name=self.name,
                    status=GateStatus.FAIL,
                    error=f"Found {len(violations)} functions with complexity > {self.max_complexity}",
                    output="\n".join(violations),
                    fail_action=self.config.fail_action,
                )

            return GateResult(
                name=self.name,
                status=GateStatus.PASS,
                output=f"All functions have complexity <= {self.max_complexity}",
                fail_action=self.config.fail_action,
            )

        except Exception as e:
            return GateResult(
                name=self.name,
                status=GateStatus.FAIL,
                error=str(e),
                fail_action=self.config.fail_action,
            )


class DuplicationGate(BaseGate):
    """重复代码检查 - 检测新代码中的重复片段"""

    def __init__(self, name: str, config: dict):
        super().__init__(name, config)
        self.min_lines = config.get("min_lines", 6)

    def run(self, repo_path: str, **kwargs) -> GateResult:
        if not self.config.enabled:
            return GateResult(
                name=self.name,
                status=GateStatus.SKIPPED,
                fail_action=self.config.fail_action,
            )

        try:
            # 获取修改的文件列表
            diff_result = subprocess.run(
                ["git", "diff", "--name-only", "main", "--", "*.py"],
                cwd=repo_path, capture_output=True, text=True, timeout=30,
            )

            if diff_result.returncode != 0 or not diff_result.stdout.strip():
                return GateResult(
                    name=self.name,
                    status=GateStatus.PASS,
                    output="No Python files changed",
                    fail_action=self.config.fail_action,
                )

            # 用 jscpd 或简单的重复检测
            changed_files = [f.strip() for f in diff_result.stdout.strip().split("\n") if f.strip()]
            duplicates = self._find_duplicates(repo_path, changed_files)

            if duplicates:
                return GateResult(
                    name=self.name,
                    status=GateStatus.FAIL,
                    error=f"Found {len(duplicates)} duplicated code blocks",
                    output="\n".join(duplicates[:20]),
                    fail_action=self.config.fail_action,
                )

            return GateResult(
                name=self.name,
                status=GateStatus.PASS,
                output="No significant code duplication found",
                fail_action=self.config.fail_action,
            )

        except Exception as e:
            return GateResult(
                name=self.name,
                status=GateStatus.FAIL,
                error=str(e),
                fail_action=self.config.fail_action,
            )

    def _find_duplicates(self, repo_path: str, files: list) -> list:
        """简单的重复代码检测"""
        duplicates = []
        blocks = {}  # normalized_code -> (file, line)

        for filepath in files:
            full_path = os.path.join(repo_path, filepath)
            if not os.path.isfile(full_path):
                continue

            try:
                with open(full_path) as f:
                    lines = f.readlines()
            except (UnicodeDecodeError, PermissionError):
                continue

            # 滑动窗口检测重复块
            for i in range(len(lines) - self.min_lines + 1):
                block = "".join(lines[i:i + self.min_lines]).strip()
                if not block or len(block) < 30:
                    continue

                normalized = re.sub(r'\s+', ' ', block)

                if normalized in blocks:
                    orig_file, orig_line = blocks[normalized]
                    if orig_file != filepath:
                        duplicates.append(
                            f"Duplicate in {filepath}:{i+1} (same as {orig_file}:{orig_line})"
                        )
                else:
                    blocks[normalized] = (filepath, i + 1)

        return duplicates


class DeadCodeGate(BaseGate):
    """死代码检查 - 使用 vulture 检测未使用的代码"""

    def run(self, repo_path: str, **kwargs) -> GateResult:
        if not self.config.enabled:
            return GateResult(
                name=self.name,
                status=GateStatus.SKIPPED,
                fail_action=self.config.fail_action,
            )

        try:
            result = subprocess.run(
                ["python3", "-m", "vulture", ".", "--min-confidence", "80"],
                cwd=repo_path, capture_output=True, text=True, timeout=60,
            )

            output = result.stdout.strip()

            # vulture 返回码 0 = 没有死代码, 1 = 有死代码
            if result.returncode == 0 or not output:
                return GateResult(
                    name=self.name,
                    status=GateStatus.PASS,
                    output="No dead code found",
                    fail_action=self.config.fail_action,
                )

            # 过滤只保留修改文件中的死代码
            diff_result = subprocess.run(
                ["git", "diff", "--name-only", "main"],
                cwd=repo_path, capture_output=True, text=True, timeout=30,
            )
            changed_files = set(
                f.strip() for f in (diff_result.stdout or "").strip().split("\n") if f.strip()
            )

            relevant = []
            for line in output.split("\n"):
                for cf in changed_files:
                    if cf in line:
                        relevant.append(line)
                        break

            if relevant:
                return GateResult(
                    name=self.name,
                    status=GateStatus.FAIL,
                    error=f"Found {len(relevant)} dead code items in changed files",
                    output="\n".join(relevant),
                    fail_action=self.config.fail_action,
                )

            return GateResult(
                name=self.name,
                status=GateStatus.PASS,
                output="No dead code in changed files",
                fail_action=self.config.fail_action,
            )

        except Exception as e:
            return GateResult(
                name=self.name,
                status=GateStatus.FAIL,
                error=str(e),
                fail_action=self.config.fail_action,
            )


class DependencyGate(BaseGate):
    """依赖检查 - 检测已知漏洞的依赖"""

    def run(self, repo_path: str, **kwargs) -> GateResult:
        if not self.config.enabled:
            return GateResult(
                name=self.name,
                status=GateStatus.SKIPPED,
                fail_action=self.config.fail_action,
            )

        try:
            # 检测项目类型并运行对应的审计命令
            audit_results = []

            # Python: pip-audit
            if os.path.exists(os.path.join(repo_path, "requirements.txt")) or \
               os.path.exists(os.path.join(repo_path, "Pipfile")) or \
               os.path.exists(os.path.join(repo_path, "pyproject.toml")):
                result = subprocess.run(
                    ["python3", "-m", "pip_audit", "-r", "requirements.txt"],
                    cwd=repo_path, capture_output=True, text=True, timeout=60,
                )
                if result.returncode != 0 and result.stdout.strip():
                    audit_results.append(f"Python dependencies:\n{result.stdout}")

            # Node: npm audit
            if os.path.exists(os.path.join(repo_path, "package.json")):
                result = subprocess.run(
                    ["npm", "audit", "--production"],
                    cwd=repo_path, capture_output=True, text=True, timeout=60,
                )
                if result.returncode != 0 and result.stdout.strip():
                    audit_results.append(f"Node dependencies:\n{result.stdout}")

            if audit_results:
                return GateResult(
                    name=self.name,
                    status=GateStatus.FAIL,
                    error="Vulnerable dependencies found",
                    output="\n\n".join(audit_results),
                    fail_action=self.config.fail_action,
                )

            return GateResult(
                name=self.name,
                status=GateStatus.PASS,
                output="No dependency files found or no vulnerabilities detected",
                fail_action=self.config.fail_action,
            )

        except Exception as e:
            return GateResult(
                name=self.name,
                status=GateStatus.SKIPPED,
                output=f"Dependency check skipped: {e}",
                fail_action=self.config.fail_action,
            )


# ============================================================
# AI 专用门禁 - 针对 AI 自动生成代码的独特风险
# ============================================================


class FilePermissionsGate(BaseGate):
    """文件权限检查 - 防止 AI 误改系统文件、敏感文件"""

    def __init__(self, name: str, config: dict):
        super().__init__(name, config)
        self.blocked_patterns = config.get("blocked_patterns", [
            ".git/", "__pycache__/", "node_modules/", ".env", "*.pem", "*.key",
            "/etc/", "/usr/bin/", "/var/", "package-lock.json", "poetry.lock",
            ".DS_Store", "Thumbs.db", "*.swp", "*.swo",
        ])

    def run(self, repo_path: str, **kwargs) -> GateResult:
        if not self.config.enabled:
            return GateResult(name=self.name, status=GateStatus.SKIPPED, fail_action=self.config.fail_action)

        try:
            result = subprocess.run(
                ["git", "diff", "--name-only", "main"],
                cwd=repo_path, capture_output=True, text=True, timeout=30,
            )
            if result.returncode != 0 or not result.stdout.strip():
                return GateResult(name=self.name, status=GateStatus.PASS, output="No changed files", fail_action=self.config.fail_action)

            changed_files = [f.strip() for f in result.stdout.strip().split("\n") if f.strip()]
            violations = []

            for filepath in changed_files:
                for pattern in self.blocked_patterns:
                    clean = pattern.strip("*")
                    if clean in filepath:
                        violations.append(f"{filepath} (matched: {pattern})")
                        break

            if violations:
                return GateResult(
                    name=self.name, status=GateStatus.FAIL,
                    error=f"Found {len(violations)} blocked file modifications",
                    output="\n".join(violations),
                    fail_action=self.config.fail_action,
                )
            return GateResult(name=self.name, status=GateStatus.PASS, output="No blocked files modified", fail_action=self.config.fail_action)
        except Exception as e:
            return GateResult(name=self.name, status=GateStatus.FAIL, error=str(e), fail_action=self.config.fail_action)


class DebugCodeGate(BaseGate):
    """调试代码检查 - 检测 AI 留下的 print/console.log/debugger"""

    def __init__(self, name: str, config: dict):
        super().__init__(name, config)
        self.patterns = config.get("patterns", [
            r"\bprint\s*\(", r"\bconsole\.log\s*\(", r"\bdebugger\b",
            r"\bbreakpoint\s*\(", r"\bimport\s+pdb\b", r"\bimport\s+ipdb\b",
            r"\bprintf\s*\(", r"\bSystem\.out\.print", r"\blog\.debug\s*\(",
        ])
        self.exclude = config.get("exclude", ["test_", "_test.", "spec_", "_spec."])

    def run(self, repo_path: str, **kwargs) -> GateResult:
        if not self.config.enabled:
            return GateResult(name=self.name, status=GateStatus.SKIPPED, fail_action=self.config.fail_action)

        try:
            diff_result = subprocess.run(
                ["git", "diff", "--name-only", "main"],
                cwd=repo_path, capture_output=True, text=True, timeout=30,
            )
            if diff_result.returncode != 0 or not diff_result.stdout.strip():
                return GateResult(name=self.name, status=GateStatus.PASS, output="No changed files", fail_action=self.config.fail_action)

            changed_files = [f.strip() for f in diff_result.stdout.strip().split("\n") if f.strip()]
            findings = []

            for filepath in changed_files:
                if any(ex in filepath for ex in self.exclude):
                    continue
                full_path = os.path.join(repo_path, filepath)
                if not os.path.isfile(full_path):
                    continue
                try:
                    with open(full_path, "r") as f:
                        for line_num, line in enumerate(f, 1):
                            for pattern in self.patterns:
                                if re.search(pattern, line):
                                    findings.append(f"{filepath}:{line_num}: {line.strip()}")
                                    break
                except (UnicodeDecodeError, PermissionError):
                    continue

            if findings:
                return GateResult(
                    name=self.name, status=GateStatus.FAIL,
                    error=f"Found {len(findings)} debug statements",
                    output="\n".join(findings),
                    fail_action=self.config.fail_action,
                )
            return GateResult(name=self.name, status=GateStatus.PASS, output="No debug code found", fail_action=self.config.fail_action)
        except Exception as e:
            return GateResult(name=self.name, status=GateStatus.FAIL, error=str(e), fail_action=self.config.fail_action)


class HardcodingGate(BaseGate):
    """硬编码检查 - 检测 AI 硬编码的敏感信息"""

    def __init__(self, name: str, config: dict):
        super().__init__(name, config)
        self.suspicious_patterns = config.get("suspicious_patterns", [
            r"password\s*=\s*['\"][^'\"]+['\"]", r"api_key\s*=\s*['\"][^'\"]+['\"]",
            r"secret\s*=\s*['\"][^'\"]+['\"]", r"token\s*=\s*['\"][^'\"]+['\"]",
            r"http://127\.0\.0\.1", r"http://localhost", r"/tmp/",
            r"AKIA[0-9A-Z]{16}",  # AWS key pattern
        ])

    def run(self, repo_path: str, **kwargs) -> GateResult:
        if not self.config.enabled:
            return GateResult(name=self.name, status=GateStatus.SKIPPED, fail_action=self.config.fail_action)

        try:
            diff_result = subprocess.run(
                ["git", "diff", "--name-only", "main"],
                cwd=repo_path, capture_output=True, text=True, timeout=30,
            )
            if diff_result.returncode != 0 or not diff_result.stdout.strip():
                return GateResult(name=self.name, status=GateStatus.PASS, output="No changed files", fail_action=self.config.fail_action)

            changed_files = [f.strip() for f in diff_result.stdout.strip().split("\n") if f.strip()]
            findings = []

            for filepath in changed_files:
                full_path = os.path.join(repo_path, filepath)
                if not os.path.isfile(full_path):
                    continue
                try:
                    with open(full_path, "r") as f:
                        for line_num, line in enumerate(f, 1):
                            for pattern in self.suspicious_patterns:
                                if re.search(pattern, line, re.IGNORECASE):
                                    findings.append(f"{filepath}:{line_num}: {line.strip()}")
                                    break
                except (UnicodeDecodeError, PermissionError):
                    continue

            if findings:
                return GateResult(
                    name=self.name, status=GateStatus.FAIL,
                    error=f"Found {len(findings)} hardcoded suspicious values",
                    output="\n".join(findings),
                    fail_action=self.config.fail_action,
                )
            return GateResult(name=self.name, status=GateStatus.PASS, output="No hardcoded secrets found", fail_action=self.config.fail_action)
        except Exception as e:
            return GateResult(name=self.name, status=GateStatus.FAIL, error=str(e), fail_action=self.config.fail_action)


class CoreFilesGate(BaseGate):
    """核心文件保护 - 防止 AI 随意修改核心逻辑文件"""

    def __init__(self, name: str, config: dict):
        super().__init__(name, config)
        self.protected_files = config.get("protected_files", [
            "__init__.py", "models.py", "schema.sql", "config.py",
            "database.py", "auth.py", "settings.py", "middleware.py",
            "migrations/", "schema.prisma",
        ])

    def run(self, repo_path: str, **kwargs) -> GateResult:
        if not self.config.enabled:
            return GateResult(name=self.name, status=GateStatus.SKIPPED, fail_action=self.config.fail_action)

        try:
            result = subprocess.run(
                ["git", "diff", "--name-only", "main"],
                cwd=repo_path, capture_output=True, text=True, timeout=30,
            )
            if result.returncode != 0 or not result.stdout.strip():
                return GateResult(name=self.name, status=GateStatus.PASS, output="No changed files", fail_action=self.config.fail_action)

            changed_files = [f.strip() for f in result.stdout.strip().split("\n") if f.strip()]
            warnings = []

            for filepath in changed_files:
                basename = os.path.basename(filepath)
                for protected in self.protected_files:
                    if protected.endswith("/") and protected in filepath + "/":
                        warnings.append(f"{filepath} (protected path: {protected})")
                    elif basename == protected:
                        warnings.append(f"{filepath} (protected file: {protected})")

            if warnings:
                return GateResult(
                    name=self.name, status=GateStatus.FAIL,
                    error=f"Found {len(warnings)} modifications to protected files",
                    output="\n".join(warnings),
                    fail_action=self.config.fail_action,
                )
            return GateResult(name=self.name, status=GateStatus.PASS, output="No protected files modified", fail_action=self.config.fail_action)
        except Exception as e:
            return GateResult(name=self.name, status=GateStatus.FAIL, error=str(e), fail_action=self.config.fail_action)


class DocumentationGate(BaseGate):
    """文档更新检查 - 检测功能变更是否伴随文档更新"""

    def __init__(self, name: str, config: dict):
        super().__init__(name, config)
        self.doc_files = config.get("doc_files", ["README.md", "CHANGELOG.md", "docs/"])

    def run(self, repo_path: str, **kwargs) -> GateResult:
        if not self.config.enabled:
            return GateResult(name=self.name, status=GateStatus.SKIPPED, fail_action=self.config.fail_action)

        try:
            result = subprocess.run(
                ["git", "diff", "--name-only", "main"],
                cwd=repo_path, capture_output=True, text=True, timeout=30,
            )
            if result.returncode != 0 or not result.stdout.strip():
                return GateResult(name=self.name, status=GateStatus.PASS, output="No changed files", fail_action=self.config.fail_action)

            changed_files = [f.strip() for f in result.stdout.strip().split("\n") if f.strip()]

            has_code_changes = any(
                f.endswith((".py", ".ts", ".js", ".java", ".go", ".rs"))
                for f in changed_files
            )
            has_doc_changes = any(
                any(df.rstrip("/") in f for df in self.doc_files)
                for f in changed_files
            )

            if has_code_changes and not has_doc_changes:
                return GateResult(
                    name=self.name, status=GateStatus.FAIL,
                    error="Code changes detected but no documentation updates found",
                    output=f"Changed files: {', '.join(changed_files[:10])}",
                    fail_action=self.config.fail_action,
                )
            return GateResult(name=self.name, status=GateStatus.PASS, output="Documentation check passed", fail_action=self.config.fail_action)
        except Exception as e:
            return GateResult(name=self.name, status=GateStatus.FAIL, error=str(e), fail_action=self.config.fail_action)


class ExceptionHandlingGate(BaseGate):
    """异常处理检查 - 检测过于宽泛的异常捕获"""

    def __init__(self, name: str, config: dict):
        super().__init__(name, config)
        default_patterns = [
            (r"except\s*:", "bare except (no exception type)"),
            (r"except\s+Exception\s*:", "catching generic Exception"),
            (r"except\s+BaseException\s*:", "catching BaseException"),
            (r"catch\s*\(\s*\)", "empty catch block (JS)"),
            (r"catch\s*\(\s*Error\s*\)", "catching generic Error (JS)"),
        ]
        raw = config.get("broad_patterns", [])
        if raw and isinstance(raw[0], str):
            # config 里是纯字符串列表，转为 (pattern, desc) 元组
            self.broad_patterns = [(p, f"broad exception pattern: {p}") for p in raw]
        else:
            self.broad_patterns = raw or default_patterns

    def run(self, repo_path: str, **kwargs) -> GateResult:
        if not self.config.enabled:
            return GateResult(name=self.name, status=GateStatus.SKIPPED, fail_action=self.config.fail_action)

        try:
            diff_result = subprocess.run(
                ["git", "diff", "--name-only", "main"],
                cwd=repo_path, capture_output=True, text=True, timeout=30,
            )
            if diff_result.returncode != 0 or not diff_result.stdout.strip():
                return GateResult(name=self.name, status=GateStatus.PASS, output="No changed files", fail_action=self.config.fail_action)

            changed_files = [f.strip() for f in diff_result.stdout.strip().split("\n") if f.strip()]
            findings = []

            for filepath in changed_files:
                full_path = os.path.join(repo_path, filepath)
                if not os.path.isfile(full_path):
                    continue
                try:
                    with open(full_path, "r") as f:
                        for line_num, line in enumerate(f, 1):
                            for pattern, desc in self.broad_patterns:
                                if re.search(pattern, line):
                                    findings.append(f"{filepath}:{line_num}: [{desc}] {line.strip()}")
                except (UnicodeDecodeError, PermissionError):
                    continue

            if findings:
                return GateResult(
                    name=self.name, status=GateStatus.FAIL,
                    error=f"Found {len(findings)} broad exception handlers",
                    output="\n".join(findings),
                    fail_action=self.config.fail_action,
                )
            return GateResult(name=self.name, status=GateStatus.PASS, output="Exception handling looks good", fail_action=self.config.fail_action)
        except Exception as e:
            return GateResult(name=self.name, status=GateStatus.FAIL, error=str(e), fail_action=self.config.fail_action)


class PerformanceGate(BaseGate):
    """性能回归检查 - 检测过度嵌套和潜在性能问题"""

    def __init__(self, name: str, config: dict):
        super().__init__(name, config)
        self.nesting_threshold = config.get("nesting_threshold", 5)

    def run(self, repo_path: str, **kwargs) -> GateResult:
        if not self.config.enabled:
            return GateResult(name=self.name, status=GateStatus.SKIPPED, fail_action=self.config.fail_action)

        try:
            diff_result = subprocess.run(
                ["git", "diff", "--name-only", "main"],
                cwd=repo_path, capture_output=True, text=True, timeout=30,
            )
            if diff_result.returncode != 0 or not diff_result.stdout.strip():
                return GateResult(name=self.name, status=GateStatus.PASS, output="No changed files", fail_action=self.config.fail_action)

            changed_files = [f.strip() for f in diff_result.stdout.strip().split("\n") if f.strip()]
            findings = []

            for filepath in changed_files:
                full_path = os.path.join(repo_path, filepath)
                if not os.path.isfile(full_path):
                    continue
                try:
                    with open(full_path, "r") as f:
                        max_nesting = 0
                        current_nesting = 0
                        for line_num, line in enumerate(f, 1):
                            stripped = line.strip()
                            if not stripped or stripped.startswith("#") or stripped.startswith("//"):
                                continue
                            indent = len(line) - len(line.lstrip())
                            nesting = indent // 4
                            if nesting > max_nesting:
                                max_nesting = nesting
                                deep_line = f"{filepath}:{line_num}: nesting={nesting} — {stripped[:80]}"
                    if max_nesting > self.nesting_threshold:
                        findings.append(deep_line)
                except (UnicodeDecodeError, PermissionError):
                    continue

            if findings:
                return GateResult(
                    name=self.name, status=GateStatus.FAIL,
                    error=f"Found {len(findings)} deeply nested code blocks (>{self.nesting_threshold} levels)",
                    output="\n".join(findings),
                    fail_action=self.config.fail_action,
                )
            return GateResult(name=self.name, status=GateStatus.PASS, output=f"All code within nesting threshold ({self.nesting_threshold})", fail_action=self.config.fail_action)
        except Exception as e:
            return GateResult(name=self.name, status=GateStatus.FAIL, error=str(e), fail_action=self.config.fail_action)


class NamingGate(BaseGate):
    """变量命名检查 - 检测 AI 生成的不规范命名"""

    def __init__(self, name: str, config: dict):
        super().__init__(name, config)
        self.bad_names = config.get("bad_names", [
            r"\bvar\d+\b", r"\btemp\d+\b", r"\btmp\d+\b",
            r"\bobj\d+\b", r"\bval\d+\b", r"\bparam\d+\b",
            r"\barg\d+\b", r"\bflag\d+\b", r"\bfoo\b", r"\bbar\b", r"\bbaz\b",
        ])

    def run(self, repo_path: str, **kwargs) -> GateResult:
        if not self.config.enabled:
            return GateResult(name=self.name, status=GateStatus.SKIPPED, fail_action=self.config.fail_action)

        try:
            diff_result = subprocess.run(
                ["git", "diff", "--name-only", "main"],
                cwd=repo_path, capture_output=True, text=True, timeout=30,
            )
            if diff_result.returncode != 0 or not diff_result.stdout.strip():
                return GateResult(name=self.name, status=GateStatus.PASS, output="No changed files", fail_action=self.config.fail_action)

            changed_files = [f.strip() for f in diff_result.stdout.strip().split("\n") if f.strip()]
            findings = []

            for filepath in changed_files:
                full_path = os.path.join(repo_path, filepath)
                if not os.path.isfile(full_path):
                    continue
                try:
                    with open(full_path, "r") as f:
                        for line_num, line in enumerate(f, 1):
                            stripped = line.strip()
                            if stripped.startswith("#") or stripped.startswith("//") or stripped.startswith('"""') or stripped.startswith("'''"):
                                continue
                            for pattern in self.bad_names:
                                if re.search(pattern, line):
                                    findings.append(f"{filepath}:{line_num}: {stripped[:80]}")
                                    break
                except (UnicodeDecodeError, PermissionError):
                    continue

            if findings:
                return GateResult(
                    name=self.name, status=GateStatus.FAIL,
                    error=f"Found {len(findings)} poorly named variables",
                    output="\n".join(findings[:20]),
                    fail_action=self.config.fail_action,
                )
            return GateResult(name=self.name, status=GateStatus.PASS, output="Variable names look good", fail_action=self.config.fail_action)
        except Exception as e:
            return GateResult(name=self.name, status=GateStatus.FAIL, error=str(e), fail_action=self.config.fail_action)


class CoverageDeltaGate(BaseGate):
    """增量覆盖率检查 - 检测新增代码的测试覆盖率"""

    def __init__(self, name: str, config: dict):
        super().__init__(name, config)
        self.min_delta_coverage = config.get("min_delta_coverage", 80.0)

    def run(self, repo_path: str, **kwargs) -> GateResult:
        if not self.config.enabled:
            return GateResult(name=self.name, status=GateStatus.SKIPPED, fail_action=self.config.fail_action)

        try:
            # 运行覆盖率分析，只针对修改的文件
            diff_result = subprocess.run(
                ["git", "diff", "--name-only", "main", "--", "*.py"],
                cwd=repo_path, capture_output=True, text=True, timeout=30,
            )
            if diff_result.returncode != 0 or not diff_result.stdout.strip():
                return GateResult(name=self.name, status=GateStatus.PASS, output="No Python files changed", fail_action=self.config.fail_action)

            # 自动检测测试命令（优先使用 pytest，回退到 unittest）
            test_cmd = ["python3", "-m", "coverage", "run", "-m", "pytest", "tests/", "-x", "-q"]
            run_result = subprocess.run(
                test_cmd,
                cwd=repo_path, capture_output=True, text=True, timeout=120,
            )
            if run_result.returncode != 0:
                return GateResult(
                    name=self.name, status=GateStatus.FAIL,
                    error="Tests failed during coverage analysis",
                    output=run_result.stderr or run_result.stdout,
                    fail_action=self.config.fail_action,
                )

            report_result = subprocess.run(
                ["python3", "-m", "coverage", "report"],
                cwd=repo_path, capture_output=True, text=True, timeout=30,
            )
            output = report_result.stdout

            # 提取总体覆盖率
            total_match = re.search(r'TOTAL.*?(\d+(?:\.\d+)?)%', output)
            if total_match:
                coverage = float(total_match.group(1))
                if coverage < self.min_delta_coverage:
                    return GateResult(
                        name=self.name, status=GateStatus.FAIL,
                        error=f"Coverage {coverage:.1f}% below threshold {self.min_delta_coverage:.1f}%",
                        output=output,
                        fail_action=self.config.fail_action,
                    )
                return GateResult(
                    name=self.name, status=GateStatus.PASS,
                    output=f"Coverage: {coverage:.1f}% (threshold: {self.min_delta_coverage:.1f}%)\n{output}",
                    fail_action=self.config.fail_action,
                )

            return GateResult(name=self.name, status=GateStatus.SKIPPED, output="Could not parse coverage report", fail_action=self.config.fail_action)
        except Exception as e:
            return GateResult(name=self.name, status=GateStatus.FAIL, error=str(e), fail_action=self.config.fail_action)


class ModelConsistencyGate(BaseGate):
    """模型一致性检查 - 记录和比较 AI 生成的代码"""

    def __init__(self, name: str, config: dict):
        super().__init__(name, config)
        self.history_dir = config.get("history_dir", ".claude/model_history")
        self.max_diff_ratio = config.get("max_diff_ratio", 0.5)

    def run(self, repo_path: str, **kwargs) -> GateResult:
        if not self.config.enabled:
            return GateResult(name=self.name, status=GateStatus.SKIPPED, fail_action=self.config.fail_action)

        try:
            history_path = os.path.join(repo_path, self.history_dir)
            os.makedirs(history_path, exist_ok=True)

            # 获取当前 diff
            diff_result = subprocess.run(
                ["git", "diff", "main"],
                cwd=repo_path, capture_output=True, text=True, timeout=30,
            )
            current_diff = diff_result.stdout

            if not current_diff.strip():
                return GateResult(name=self.name, status=GateStatus.PASS, output="No changes to compare", fail_action=self.config.fail_action)

            # 保存当前实现快照
            import hashlib
            diff_hash = hashlib.md5(current_diff.encode()).hexdigest()[:8]
            snapshot_file = os.path.join(history_path, f"latest_{diff_hash}.diff")
            with open(snapshot_file, "w") as f:
                f.write(current_diff)

            # 检查是否有之前的实现可以比较
            import glob as glob_mod
            prev_snapshots = sorted(glob_mod.glob(os.path.join(history_path, "latest_*.diff")))
            prev_snapshots = [s for s in prev_snapshots if s != snapshot_file]

            if prev_snapshots:
                latest_prev = prev_snapshots[-1]
                with open(latest_prev) as f:
                    prev_diff = f.read()

                # 简单比较：计算行差异比例
                current_lines = set(current_diff.split("\n"))
                prev_lines = set(prev_diff.split("\n"))
                common = current_lines & prev_lines
                total = len(current_lines | prev_lines)

                if total > 0:
                    diff_ratio = 1.0 - (len(common) / total)
                    if diff_ratio > self.max_diff_ratio:
                        return GateResult(
                            name=self.name, status=GateStatus.FAIL,
                            error=f"Implementation drift: {diff_ratio:.0%} different from previous attempt (max: {self.max_diff_ratio:.0%})",
                            output=f"Current hash: {diff_hash}\nPrevious: {os.path.basename(latest_prev)}",
                            fail_action=self.config.fail_action,
                        )
                    return GateResult(
                        name=self.name, status=GateStatus.PASS,
                        output=f"Consistency check: {diff_ratio:.0%} different (threshold: {self.max_diff_ratio:.0%})",
                        fail_action=self.config.fail_action,
                    )

            return GateResult(name=self.name, status=GateStatus.PASS, output="First implementation, no history to compare", fail_action=self.config.fail_action)
        except Exception as e:
            return GateResult(name=self.name, status=GateStatus.FAIL, error=str(e), fail_action=self.config.fail_action)


class ImportValidationGate(BaseGate):
    """导入验证门禁 - 检测新增/修改的 Python 模块是否能正常导入"""

    def run(self, repo_path: str, **kwargs) -> GateResult:
        if not self.config.enabled:
            return GateResult(name=self.name, status=GateStatus.SKIPPED, fail_action=self.config.fail_action)

        try:
            diff_result = subprocess.run(
                ["git", "diff", "--name-only", "main", "--", "*.py"],
                cwd=repo_path, capture_output=True, text=True, timeout=30,
            )
            if diff_result.returncode != 0 or not diff_result.stdout.strip():
                return GateResult(name=self.name, status=GateStatus.PASS, output="No Python files changed", fail_action=self.config.fail_action)

            changed_files = [f.strip() for f in diff_result.stdout.strip().split("\n") if f.strip()]
            # 提取需要验证的 Python 模块路径
            modules_to_test = set()
            for filepath in changed_files:
                # 把路径转为模块导入路径: app/api/v1/views.py -> app.api.v1.views
                if filepath.endswith(".py") and "/" in filepath:
                    module = filepath[:-3].replace("/", ".")
                    # 同时验证父包（确保 __init__.py 能导入）
                    parts = module.split(".")
                    for i in range(1, len(parts)):
                        modules_to_test.add(".".join(parts[:i]))
                    modules_to_test.add(module)

            if not modules_to_test:
                return GateResult(name=self.name, status=GateStatus.PASS, output="No importable modules found", fail_action=self.config.fail_action)

            # 逐个验证模块是否能导入
            failures = []
            for module in sorted(modules_to_test):
                result = subprocess.run(
                    ["python3", "-c", f"import {module}"],
                    cwd=repo_path, capture_output=True, text=True, timeout=30,
                )
                if result.returncode != 0:
                    error_msg = result.stderr.strip().split("\n")[-1]  # 取最后一行（实际错误）
                    failures.append(f"{module}: {error_msg}")

            if failures:
                return GateResult(
                    name=self.name, status=GateStatus.FAIL,
                    error=f"Found {len(failures)} import errors",
                    output="\n".join(failures),
                    fail_action=self.config.fail_action,
                )
            return GateResult(
                name=self.name, status=GateStatus.PASS,
                output=f"All {len(modules_to_test)} modules import successfully",
                fail_action=self.config.fail_action,
            )
        except Exception as e:
            return GateResult(name=self.name, status=GateStatus.FAIL, error=str(e), fail_action=self.config.fail_action)


class TypeCheckGate(BaseGate):
    """类型检查门禁 - 使用 mypy/pyright 检查类型错误，兼容指定 Python 版本"""

    def __init__(self, name: str, config: dict):
        super().__init__(name, config)
        self.python_version = config.get("python_version", "")  # e.g. "3.9"

    def run(self, repo_path: str, **kwargs) -> GateResult:
        if not self.config.enabled or not self.config.command:
            return GateResult(name=self.name, status=GateStatus.SKIPPED, fail_action=self.config.fail_action)

        import time
        start = time.time()
        try:
            # 构建 mypy 命令，自动添加 --python-version
            cmd = self.config.command.split()
            if self.python_version and "--python-version" not in cmd:
                cmd.extend(["--python-version", self.python_version])

            result = subprocess.run(
                cmd,
                cwd=repo_path, capture_output=True, text=True, timeout=120,
            )
            duration = int((time.time() - start) * 1000)
            output = result.stdout + result.stderr

            if result.returncode == 0:
                return GateResult(
                    name=self.name, status=GateStatus.PASS,
                    output=output or "Type check passed",
                    duration_ms=duration, fail_action=self.config.fail_action,
                )
            else:
                # 统计错误数
                error_count = output.count("error:")
                return GateResult(
                    name=self.name, status=GateStatus.FAIL,
                    output=output[:2000],
                    error=f"Type check found {error_count} error(s)" if error_count else "Type check failed",
                    duration_ms=duration, fail_action=self.config.fail_action,
                )
        except FileNotFoundError:
            return GateResult(
                name=self.name, status=GateStatus.SKIPPED,
                output="Type checker not installed, skipping",
                fail_action=self.config.fail_action,
            )
        except subprocess.TimeoutExpired:
            return GateResult(
                name=self.name, status=GateStatus.FAIL,
                error="Type check timed out (120s)",
                duration_ms=120000, fail_action=self.config.fail_action,
            )
        except Exception as e:
            return GateResult(name=self.name, status=GateStatus.FAIL, error=str(e), fail_action=self.config.fail_action)


class GateRunner:
    """门禁执行器 - 批量执行门禁并汇总结果"""

    def __init__(self, config: dict):
        self.gates = self._init_gates(config)

    def _init_gates(self, config: dict) -> List[BaseGate]:
        """根据配置初始化门禁"""
        gates_config = config.get("gates", {})
        gates = []

        for gate_name in ["test", "lint", "format"]:
            if gate_name in gates_config:
                gates.append(CommandGate(gate_name, gates_config[gate_name]))

        # type_check 使用 TypeCheckGate（支持 python_version 配置）
        if "type_check" in gates_config:
            gates.append(TypeCheckGate("type_check", gates_config["type_check"]))

        if "coverage" in gates_config:
            gates.append(CoverageGate("coverage", gates_config["coverage"]))

        if "security" in gates_config:
            gates.append(SecurityGate("security", gates_config["security"]))

        if "scope" in gates_config:
            gates.append(ScopeGate("scope", gates_config["scope"]))

        if "todo" in gates_config:
            gates.append(TodoGate("todo", gates_config["todo"]))

        if "complexity" in gates_config:
            gates.append(ComplexityGate("complexity", gates_config["complexity"]))

        if "duplication" in gates_config:
            gates.append(DuplicationGate("duplication", gates_config["duplication"]))

        if "dead_code" in gates_config:
            gates.append(DeadCodeGate("dead_code", gates_config["dead_code"]))

        if "dependencies" in gates_config:
            gates.append(DependencyGate("dependencies", gates_config["dependencies"]))

        # AI 专用门禁
        if "file_permissions" in gates_config:
            gates.append(FilePermissionsGate("file_permissions", gates_config["file_permissions"]))

        if "debug_code" in gates_config:
            gates.append(DebugCodeGate("debug_code", gates_config["debug_code"]))

        if "hardcoding" in gates_config:
            gates.append(HardcodingGate("hardcoding", gates_config["hardcoding"]))

        if "core_files" in gates_config:
            gates.append(CoreFilesGate("core_files", gates_config["core_files"]))

        if "documentation" in gates_config:
            gates.append(DocumentationGate("documentation", gates_config["documentation"]))

        if "exception_handling" in gates_config:
            gates.append(ExceptionHandlingGate("exception_handling", gates_config["exception_handling"]))

        if "performance" in gates_config:
            gates.append(PerformanceGate("performance", gates_config["performance"]))

        if "naming" in gates_config:
            gates.append(NamingGate("naming", gates_config["naming"]))

        if "coverage_delta" in gates_config:
            gates.append(CoverageDeltaGate("coverage_delta", gates_config["coverage_delta"]))

        if "model_consistency" in gates_config:
            gates.append(ModelConsistencyGate("model_consistency", gates_config["model_consistency"]))

        # 导入验证门禁
        if "import_validation" in gates_config:
            gates.append(ImportValidationGate("import_validation", gates_config["import_validation"]))

        # 标准门禁
        if "commit" in gates_config:
            gates.append(CommitGate("commit", gates_config["commit"]))

        if "pr" in gates_config:
            gates.append(PRGate("pr", gates_config["pr"]))

        return gates

    def run_all(self, repo_path: str, commit_message: str = "", pr_title: str = "", pr_body: str = "") -> List[GateResult]:
        """执行所有门禁"""
        results = []
        for gate in self.gates:
            if isinstance(gate, CommitGate):
                result = gate.run(repo_path, commit_message=commit_message)
            elif isinstance(gate, PRGate):
                result = gate.run(repo_path, pr_title=pr_title, pr_body=pr_body)
            else:
                result = gate.run(repo_path)
            results.append(result)
        return results

    def should_block_pr(self, results: List[GateResult]) -> bool:
        """检查是否有需要阻塞 PR 的失败门禁"""
        for result in results:
            if result.status == GateStatus.FAIL and result.fail_action == "block":
                return True
        return False

    def generate_report(self, results: List[GateResult], branch_name: str) -> str:
        """生成门禁报告（用于 Issue 评论）"""
        lines = []
        blocked = self.should_block_pr(results)

        if blocked:
            lines.append("❌ **Gate check failed** — PR was not created.")
        else:
            lines.append("⚠️ **Gate check passed with warnings** — PR was created.")

        lines.append("")
        lines.append("| Gate | Status | Action |")
        lines.append("|------|--------|--------|")

        for result in results:
            status_icon = {
                GateStatus.PASS: "✅ Pass",
                GateStatus.FAIL: "❌ Fail",
                GateStatus.WARN: "⚠️ Warn",
                GateStatus.SKIPPED: "⏭️ Skip",
            }[result.status]

            action = result.fail_action.capitalize()
            lines.append(f"| 🚪 {result.name} | {status_icon} | {action} |")

        failed_results = [r for r in results if r.status == GateStatus.FAIL]
        if failed_results:
            lines.append("")
            lines.append("**Failed Gates Details:**")
            lines.append("")
            for result in failed_results:
                output = result.error or result.output
                if len(output) > 1000:
                    output = output[:1000] + "\n... (truncated)"
                lines.append(f"<details><summary>{result.name} ({result.fail_action})</summary>")
                lines.append("")
                lines.append("```")
                lines.append(output)
                lines.append("```")
                lines.append("</details>")
                lines.append("")

        lines.append(f"Branch `{branch_name}` has been pushed.")
        if blocked:
            lines.append("Fix the issues and create PR manually.")
        else:
            lines.append("Please review the warnings before merging.")

        return "\n".join(lines)
