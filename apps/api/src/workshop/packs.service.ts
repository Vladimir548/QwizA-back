import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { PackDto, QuestionDto } from "./dto/pack.dto";
import { MediaService } from "./media.service";
import { PacksRepository } from "./packs.repository";
import type { WorkshopPack, WorkshopQuestion, WorkshopTopic } from "./workshop.model";

@Injectable()
export class PacksService {
  constructor(
    private readonly repository: PacksRepository,
    private readonly media: MediaService,
  ) {}

  async list() {
    return this.repository.list();
  }

  async store() {
    return this.repository.listPublished();
  }

  async check(input: PackDto) {
    const errors: { path: string; message: string }[] = [];
    const warnings: { path: string; message: string }[] = [];
    if (!input.title.trim()) errors.push({ path: "Название", message: "Укажи название пака" });
    if (!input.description.trim())
      warnings.push({
        path: "Описание",
        message: "Добавь описание, чтобы игрокам было проще выбрать пак",
      });
    if (!input.cover)
      warnings.push({ path: "Обложка", message: "Добавь обложку — она появится в каталоге" });
    const rounds = input.rounds ?? ["Раунд 1"];
    if (!rounds.length || rounds.length > 5)
      errors.push({ path: "Раунды", message: "Добавь от одного до пяти раундов" });
    for (const [index, round] of rounds.entries()) {
      if (!round.trim())
        errors.push({ path: `Раунд ${index + 1}`, message: "Укажи название раунда" });
      if (!input.topics.some((topic) => (topic.roundIndex ?? 0) === index))
        errors.push({ path: `Раунд ${index + 1}`, message: "В раунде нет тем" });
    }
    if (!input.topics.length) errors.push({ path: "Темы", message: "Добавь хотя бы одну тему" });
    let questions = 0;
    for (const [index, topic] of input.topics.entries()) {
      const path = `Тема ${index + 1}: ${topic.title}`;
      if ((topic.roundIndex ?? 0) >= rounds.length)
        errors.push({ path, message: "Тема привязана к несуществующему раунду" });
      if (
        topic.isFinal &&
        (topic.questions.length !== 1 || !["text", "choice"].includes(topic.questions[0]?.type))
      )
        errors.push({
          path,
          message: "Добавь один текстовый вопрос или вопрос с выбором ответа для финала",
        });
      if (!topic.title.trim()) errors.push({ path, message: "Укажи название темы" });
      if (!topic.questions.length) errors.push({ path, message: "В теме нет вопросов" });
      for (const [number, question] of topic.questions.entries()) {
        questions++;
        try {
          this.validateQuestion(question);
          const refs = [
            question.questionMedia,
            question.answerMedia,
            question.geoMapMedia,
            question.differenceMedia,
            ...(question.matchingPairs ?? []).map((pair) => pair.media),
            ...(question.comparisonOptions ?? []).map((option) => option.media),
          ];
          for (const ref of refs)
            if (ref && !(await this.media.resolve(ref)))
              throw new BadRequestException("Медиафайл не найден. Загрузи его заново");
        } catch (error) {
          if (!(error instanceof BadRequestException)) throw error;
          errors.push({ path: `${path} · вопрос ${number + 1}`, message: error.message });
        }
      }
    }
    if (input.cover && (input.cover.kind !== "image" || !(await this.media.resolve(input.cover))))
      errors.push({ path: "Обложка", message: "Обложка должна быть загруженным изображением" });
    return {
      valid: errors.length === 0,
      errors,
      warnings,
      counts: { rounds: rounds.length, topics: input.topics.length, questions },
    };
  }

  async get(id: string) {
    const pack = await this.repository.find(id);
    if (!pack) throw new NotFoundException("Пак не найден");
    return pack;
  }

  async create(input: PackDto, author?: WorkshopPack["author"], isOfficial = false) {
    return this.save(input, undefined, author, isOfficial);
  }

  async update(id: string, input: PackDto) {
    return this.save(input, await this.get(id));
  }

  async remove(id: string) {
    await this.get(id);
    await this.repository.remove(id);
  }

  async setPublished(id: string, published: boolean) {
    const pack = await this.get(id);
    if (published && !pack.topics.some((topic) => topic.questions.length))
      throw new BadRequestException("Добавь хотя бы один вопрос перед публикацией");
    await this.repository.setPublished(id, published);
    return { ...pack, published };
  }

  private async save(
    input: PackDto,
    existing?: WorkshopPack,
    author?: WorkshopPack["author"],
    isOfficial = false,
  ) {
    if (!input.title.trim()) throw new BadRequestException("Укажи название пака");
    const rounds = input.rounds ?? ["Раунд 1"];
    if (!rounds.length || rounds.length > 5 || rounds.some((name) => !name.trim()))
      throw new BadRequestException("Добавь от одного до пяти раундов с названиями");
    if (input.topics.filter((t) => t.isFinal).length > 10)
      throw new BadRequestException("В паке может быть до 10 финальных тем");
    const knownTopics = new Set(existing?.topics.map((topic) => topic.id));
    const knownQuestions = new Set(
      existing?.topics.flatMap((topic) => topic.questions.map((q) => q.id)),
    );
    const otherIds = new Set(
      (await this.repository.list())
        .filter((pack) => pack.id !== existing?.id)
        .flatMap((pack) =>
          pack.topics.flatMap((topic) => [
            topic.id,
            ...topic.questions.map((question) => question.id),
          ]),
        ),
    );
    const usedIds = new Set<string>();
    const topics: WorkshopTopic[] = [];
    const roundTopicCounts = Array<number>(rounds.length).fill(0);
    for (const topic of input.topics) {
      if (!topic.title.trim()) throw new BadRequestException("Укажи название темы");
      const roundIndex = topic.roundIndex ?? 0;
      if (roundIndex < 0 || roundIndex >= rounds.length)
        throw new BadRequestException("Тема привязана к несуществующему раунду");
      if (!topic.isFinal && ++roundTopicCounts[roundIndex] > 6)
        throw new BadRequestException("В одном раунде может быть не больше шести тем");
      if (
        topic.isFinal &&
        (topic.questions.length > 1 ||
          (topic.questions.length === 1 && !["text", "choice"].includes(topic.questions[0].type)))
      )
        throw new BadRequestException(
          "Финальная тема должна содержать один текстовый вопрос или вопрос с выбором ответа",
        );
      const topicId = this.resolveId(topic.id, knownTopics, otherIds, usedIds);
      const questions: WorkshopQuestion[] = [];
      for (const question of topic.questions) {
        this.validateQuestion(question);
        const questionMedia = question.questionMedia
          ? await this.media.resolve(question.questionMedia)
          : undefined;
        if (question.questionMedia && !questionMedia)
          throw new BadRequestException("Медиафайл не найден");
        if (
          questionMedia?.kind === "audio" &&
          !(questionMedia.durationSeconds && questionMedia.durationSeconds >= 2)
        )
          throw new BadRequestException("Аудиофрагмент повреждён или не имеет длительности");
        if (
          question.type === "video-prediction" &&
          (!questionMedia?.durationSeconds ||
            (question.videoStopSeconds ?? 0) >= questionMedia.durationSeconds - 1)
        )
          throw new BadRequestException("Точка остановки выходит за длительность видео");
        const imageMap = question.type === "geo" && question.geoMapMode === "image";
        for (const ref of [
          question.answerMedia,
          ...(question.type === "spot-difference" ? [question.differenceMedia] : []),
          ...(imageMap ? [question.geoMapMedia] : []),
          ...(question.comparisonOptions?.map((option) => option.media) ?? []),
          ...(question.type === "matching"
            ? (question.matchingPairs?.map((pair) => pair.media) ?? [])
            : []),
        ]) {
          if (ref && !(await this.media.exists(ref)))
            throw new BadRequestException("Медиафайл не найден");
        }
        questions.push({
          id: this.resolveId(question.id, knownQuestions, otherIds, usedIds),
          type: question.type,
          answerMode: question.answerMode ?? "buzzer",
          answerTimeSeconds: question.answerTimeSeconds ?? 30,
          value: question.value,
          promptText: question.promptText.trim(),
          questionMedia,
          answerText: question.answerText.trim(),
          acceptedAnswers:
            question.type === "text" ||
            (question.type === "video-prediction" && question.correctChoiceIndex == null)
              ? [
                  ...new Set(
                    (question.acceptedAnswers ?? []).map((value) => value.trim()).filter(Boolean),
                  ),
                ]
              : [],
          answerMedia: question.answerMedia,
          choices:
            question.type === "choice" || question.type === "video-prediction"
              ? question.choices.map((choice) => choice.trim())
              : [],
          correctChoiceIndex:
            question.type === "choice" || question.type === "video-prediction"
              ? question.correctChoiceIndex
              : null,
          geoMapMode: question.type === "geo" ? (question.geoMapMode ?? "world") : undefined,
          geoMapMedia: imageMap ? question.geoMapMedia : undefined,
          geoTarget: question.type === "geo" && !imageMap ? question.geoTarget : undefined,
          geoToleranceKm: undefined,
          imageTarget:
            question.type === "image-point" || imageMap ? question.imageTarget : undefined,
          imageTolerancePercent:
            question.type === "image-point" ? question.imageTolerancePercent : undefined,
          comparisonUnit:
            question.type === "comparison" ? question.comparisonUnit?.trim() : undefined,
          comparisonOptions:
            question.type === "comparison"
              ? question.comparisonOptions?.map((option) => ({
                  ...option,
                  label: option.label.trim(),
                }))
              : undefined,
          numericTarget: question.type === "numeric-closest" ? question.numericTarget : undefined,
          numericUnit:
            question.type === "numeric-closest" ? question.numericUnit?.trim() : undefined,
          puzzleGridSize: question.type === "puzzle" ? question.puzzleGridSize : undefined,
          differenceMedia:
            question.type === "spot-difference" ? question.differenceMedia : undefined,
          differenceTargets:
            question.type === "spot-difference" ? question.differenceTargets : undefined,
          differenceTolerancePercent:
            question.type === "spot-difference" ? question.differenceTolerancePercent : undefined,
          matchingPairs:
            question.type === "matching"
              ? question.matchingPairs?.map((pair) => ({
                  element: pair.element.trim(),
                  fact: pair.fact.trim(),
                  media: pair.media,
                }))
              : undefined,
          videoStopSeconds:
            question.type === "video-prediction" ? question.videoStopSeconds : undefined,
        });
      }
      topics.push({
        id: topicId,
        isFinal: topic.isFinal ?? false,
        roundIndex,
        title: topic.title.trim(),
        ordered: topic.ordered,
        direction: topic.ordered ? topic.direction : "forward",
        questions,
      });
    }
    const now = new Date().toISOString();
    const cover = input.cover ? await this.media.resolve(input.cover) : undefined;
    if (input.cover && (!cover || cover.kind !== "image"))
      throw new BadRequestException("Для обложки выбери загруженное изображение");
    const pack: WorkshopPack = {
      id: existing?.id ?? randomUUID(),
      title: input.title.trim(),
      description: input.description.trim(),
      published: false,
      status: "draft",
      revision: existing ? (existing.revision ?? 1) + 1 : 1,
      author: existing?.author ?? author,
      isOfficial: existing?.isOfficial ?? isOfficial,
      cover,
      rounds: rounds.map((name) => name.trim()),
      topics,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await this.repository.save(pack);
    return pack;
  }

  private resolveId(
    id: string | undefined,
    known: Set<string>,
    otherIds: Set<string>,
    used: Set<string>,
  ) {
    if (id && !known.has(id) && otherIds.has(id))
      throw new BadRequestException("ID уже используется в другом паке");
    const resolved = id ?? randomUUID();
    if (used.has(resolved)) throw new BadRequestException("Повторяющийся ID темы или вопроса");
    used.add(resolved);
    return resolved;
  }

  private validateQuestion(question: QuestionDto) {
    if (
      !question.promptText.trim() &&
      !question.questionMedia &&
      !(question.type === "geo" && question.geoMapMode === "image" && question.geoMapMedia) &&
      question.type !== "comparison" &&
      question.type !== "matching"
    )
      throw new BadRequestException("Добавь текст или медиа к вопросу");
    if (question.questionMedia?.kind === "audio" && !["text", "choice"].includes(question.type))
      throw new BadRequestException(
        "Аудиофрагмент доступен для текстового ответа и выбора варианта",
      );
    if (question.answerMedia?.kind === "audio")
      throw new BadRequestException("Медиа ответа должно быть изображением или видео");
    if (question.type === "text" && !question.answerText.trim())
      throw new BadRequestException("Укажи правильный текстовый ответ");
    if (question.type === "choice") {
      if (question.choices.length < 2 || question.choices.some((choice) => !choice.trim()))
        throw new BadRequestException("Добавь минимум два непустых варианта ответа");
      if (
        question.correctChoiceIndex == null ||
        question.correctChoiceIndex >= question.choices.length
      )
        throw new BadRequestException("Отметь правильный вариант ответа");
    }
    if (question.type === "matching") {
      const pairs = question.matchingPairs ?? [];
      if (
        pairs.length < 2 ||
        pairs.length > 4 ||
        pairs.some(
          (pair) =>
            !pair.element.trim() ||
            !pair.fact.trim() ||
            pair.fact.length > 120 ||
            (pair.media && pair.media.kind !== "image"),
        ) ||
        new Set(pairs.map((pair) => pair.element.trim().toLocaleLowerCase())).size !==
          pairs.length ||
        new Set(pairs.map((pair) => pair.fact.trim().toLocaleLowerCase())).size !== pairs.length
      )
        throw new BadRequestException(
          "Добавь от 2 до 4 уникальных элементов и фактов до 120 символов",
        );
    }
    if (question.type === "video-prediction") {
      if (question.answerMedia)
        throw new BadRequestException("В этом вопросе используется только одно видео");
      if (question.questionMedia?.kind !== "video")
        throw new BadRequestException("Для «Что будет дальше?» загрузи видео");
      if (
        !question.videoStopSeconds ||
        !Number.isFinite(question.videoStopSeconds) ||
        !question.questionMedia.durationSeconds ||
        question.videoStopSeconds >= question.questionMedia.durationSeconds - 1
      )
        throw new BadRequestException("Выбери остановку минимум за секунду до конца видео");
      if (question.correctChoiceIndex == null) {
        if (!question.answerText.trim()) throw new BadRequestException("Укажи правильный ответ");
      } else if (
        question.choices.length < 2 ||
        question.choices.some((choice) => !choice.trim()) ||
        question.correctChoiceIndex >= question.choices.length
      )
        throw new BadRequestException("Укажи варианты и правильный ответ");
    }
    if (question.type === "geo") {
      if (question.geoMapMode === "image") {
        if (question.geoMapMedia?.kind !== "image")
          throw new BadRequestException("Загрузи изображение карты");
        this.validateImagePoint(question, false);
      } else {
        if (
          !question.geoTarget ||
          !Number.isFinite(question.geoTarget.lat) ||
          !Number.isFinite(question.geoTarget.lng) ||
          Math.abs(question.geoTarget.lat) > 90 ||
          Math.abs(question.geoTarget.lng) > 180
        )
          throw new BadRequestException("Поставь метку на карте");
      }
    }
    if (question.type === "image-point") {
      if (question.questionMedia?.kind !== "image")
        throw new BadRequestException("Добавь изображение и отметь правильную область");
      this.validateImagePoint(question);
    }
    if (question.type === "comparison") {
      const options = question.comparisonOptions ?? [];
      if (
        options.length < 2 ||
        options.length > 3 ||
        options.some(
          (option) =>
            !option.label.trim() ||
            !Number.isFinite(option.amount) ||
            option.amount < 0 ||
            option.media?.kind === "video",
        )
      )
        throw new BadRequestException(
          "Добавь два или три варианта с названием и значением; медиа варианта — только изображение",
        );
      if (new Set(options.map((option) => option.id)).size !== options.length)
        throw new BadRequestException("Повторяющиеся ID вариантов");
      const amounts = options.map((option) => option.amount);
      if (amounts.filter((amount) => amount === Math.max(...amounts)).length !== 1)
        throw new BadRequestException("Самый большой вариант должен быть один");
    }
    if (question.type === "numeric-closest") {
      if (question.answerMode !== "everyone")
        throw new BadRequestException("В «Кто ближе» отвечают все игроки");
      if (question.numericTarget === undefined || !Number.isFinite(question.numericTarget))
        throw new BadRequestException("Укажи правильное число");
    }
    if (question.type === "puzzle") {
      if (question.questionMedia?.kind !== "image")
        throw new BadRequestException("Для сборки загрузи изображение");
      if (
        !Number.isInteger(question.puzzleGridSize) ||
        question.puzzleGridSize! < 2 ||
        question.puzzleGridSize! > 5
      )
        throw new BadRequestException("Выбери сетку от 2×2 до 5×5");
    }
    if (question.type === "spot-difference") {
      if (question.questionMedia?.kind !== "image" || question.differenceMedia?.kind !== "image")
        throw new BadRequestException("Загрузи оба изображения для поиска отличий");
      if (!question.differenceTargets?.length || question.differenceTargets.length > 8)
        throw new BadRequestException("Отметь от 1 до 8 отличий на втором изображении");
      if (
        question.differenceTargets.some(
          (point) =>
            !Number.isFinite(point.x) ||
            !Number.isFinite(point.y) ||
            point.x < 0 ||
            point.x > 1 ||
            point.y < 0 ||
            point.y > 1,
        )
      )
        throw new BadRequestException("Точки отличий должны быть внутри изображения");
      if (
        !question.differenceTolerancePercent ||
        question.differenceTolerancePercent < 1 ||
        question.differenceTolerancePercent > 15
      )
        throw new BadRequestException("Укажи точность нажатия от 1 до 15%");
    }
  }

  private validateImagePoint(question: QuestionDto, requireTolerance = true) {
    if (!question.imageTarget)
      throw new BadRequestException("Отметь правильную точку на изображении карты или вопроса");
    if (
      question.imageTarget.x < 0 ||
      question.imageTarget.x > 1 ||
      question.imageTarget.y < 0 ||
      question.imageTarget.y > 1
    )
      throw new BadRequestException("Отметь точку на изображении");
    if (
      requireTolerance &&
      (!question.imageTolerancePercent ||
        question.imageTolerancePercent < 0.5 ||
        question.imageTolerancePercent > 30)
    )
      throw new BadRequestException("Укажи допустимое отклонение на изображении");
  }
}
